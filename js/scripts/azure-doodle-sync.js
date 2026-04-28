/**
 * azure-doodle-sync.js
 *
 * Reads doodle availability from Azure Tables (Doodle table) for a given
 * YYYY-MM month and returns entries in Store-compatible format.
 *
 * Azure Table schema:
 *   PartitionKey = player name
 *   RowKey       = date (YYYY-MM-DD)
 *   Presence of an entity means the player selected that date.
 */

function parseAzureConnStr(connStr) {
  const parts = {};
  for (const seg of connStr.split(';')) {
    const idx = seg.indexOf('=');
    if (idx > 0) parts[seg.slice(0, idx)] = seg.slice(idx + 1);
  }
  const accountName = parts['AccountName'];
  const accountKey  = parts['AccountKey'];
  const suffix      = parts['EndpointSuffix'] || 'core.windows.net';
  const protocol    = parts['DefaultEndpointsProtocol'] || 'https';
  if (!accountName || !accountKey) return null;
  return { accountName, accountKey, tableEndpoint: `${protocol}://${accountName}.table.${suffix}` };
}

async function azureTableSign(accountName, accountKey, date, canonicalizedResource) {
  const stringToSign = date + '\n' + canonicalizedResource;
  const keyBytes = Uint8Array.from(atob(accountKey), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(stringToSign));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function queryDoodleMonth(tableEndpoint, accountName, accountKey, yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const nextYM = month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
  const filter = `RowKey ge '${yearMonth}-01' and RowKey lt '${nextYM}-01'`;

  const entities = [];
  let nextPK = null;
  let nextRK = null;

  do {
    let url = `${tableEndpoint}/Doodle()?$filter=${encodeURIComponent(filter)}`;
    if (nextPK) {
      url += `&NextPartitionKey=${encodeURIComponent(nextPK)}&NextRowKey=${encodeURIComponent(nextRK || '')}`;
    }

    const date = new Date().toUTCString();
    const sig  = await azureTableSign(accountName, accountKey, date, `/${accountName}/Doodle()`);

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `SharedKeyLite ${accountName}:${sig}`,
        'Date': date,
        'x-ms-version': '2019-02-02',
        'Accept': 'application/json;odata=minimalmetadata',
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    entities.push(...(data.value || []));

    nextPK = resp.headers.get('x-ms-continuation-NextPartitionKey');
    nextRK = resp.headers.get('x-ms-continuation-NextRowKey');
  } while (nextPK);

  return entities;
}

/**
 * Fetch doodle data from Azure Tables for the given YYYY-MM month.
 *
 * @param {string}   connectionString  Azure Storage connection string
 * @param {string}   yearMonth         'YYYY-MM'
 * @param {Function} [onProgress]      Called with status message strings
 * @returns {Promise<Array<{name:string, selectedDates:string[]}>>}
 */
export async function syncDoodleFromAzure(connectionString, yearMonth, onProgress) {
  const azure = parseAzureConnStr(connectionString);
  if (!azure) throw new Error('Invalid connection string');

  onProgress?.(`Querying Azure Doodle table for ${yearMonth}…`);
  const entities = await queryDoodleMonth(
    azure.tableEndpoint, azure.accountName, azure.accountKey, yearMonth
  );

  if (!entities.length) {
    return [];
  }

  const byPlayer = {};
  for (const entity of entities) {
    const player = entity.PartitionKey;
    const date   = entity.RowKey;
    if (!byPlayer[player]) byPlayer[player] = [];
    byPlayer[player].push(date);
  }

  const entries = Object.entries(byPlayer).map(([name, dates]) => ({
    name,
    selectedDates: [...dates].sort(),
  }));

  onProgress?.(`Found ${entries.length} player(s), ${entities.length} selection(s).`);
  return entries;
}
