/**
 * azure-upload.js
 *
 * Browser-side equivalent of scripts/upload_to_azure.py.
 * Transforms a backup JSON payload and uploads all match entities
 * to Azure Tables storage using the REST API with SharedKeyLite auth.
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

async function upsertAzureEntity(tableEndpoint, accountName, accountKey, entity) {
  const { PartitionKey, RowKey } = entity;
  const resource = `Matches(PartitionKey='${encodeURIComponent(PartitionKey)}',RowKey='${encodeURIComponent(RowKey)}')`;
  const url  = `${tableEndpoint}/${resource}`;
  const date = new Date().toUTCString();
  const sig  = await azureTableSign(accountName, accountKey, date, `/${accountName}/${resource}`);

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `SharedKeyLite ${accountName}:${sig}`,
      'Content-Type': 'application/json',
      'Date': date,
      'x-ms-version': '2019-02-02',
      'Accept': 'application/json;odata=minimalmetadata',
      'Prefer': 'return-no-content',
    },
    body: JSON.stringify(entity),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
}

function transformMatches(data) {
  const { backup_timestamp: timestamp, matches } = data;
  if (!Array.isArray(matches)) throw new Error("'matches' field must be an array");
  return matches.map((match, i) => ({
    PartitionKey:     'match',
    RowKey:           `${match.Date}_R${match.RoundNumber}M${i + 1}`,
    Timestamp:        timestamp,
    Date:             match.Date,
    RoundNumber:      parseInt(match.RoundNumber),
    ScoreTeam1:       parseInt(match.ScoreTeam1),
    ScoreTeam2:       parseInt(match.ScoreTeam2),
    Team1Player1Name: match.Team1Player1Name,
    Team1Player2Name: match.Team1Player2Name,
    Team2Player1Name: match.Team2Player1Name,
    Team2Player2Name: match.Team2Player2Name,
  }));
}

/**
 * Upload a backup JSON payload to Azure Tables.
 *
 * @param {string}   connectionString  Azure Storage connection string
 * @param {object}   jsonData          Parsed backup JSON (with .matches array)
 * @param {Function} onProgress        Called with (uploaded, total) after each entity
 * @returns {Promise<number>}          Number of entities uploaded
 */
export async function uploadToAzure(connectionString, jsonData, onProgress) {
  const azure = parseAzureConnStr(connectionString);
  if (!azure) throw new Error('Invalid connection string');

  const entities = transformMatches(jsonData);
  if (!entities.length) throw new Error('No matches found in backup');

  for (let i = 0; i < entities.length; i++) {
    await upsertAzureEntity(azure.tableEndpoint, azure.accountName, azure.accountKey, entities[i]);
    onProgress?.(i + 1, entities.length);
  }

  return entities.length;
}
