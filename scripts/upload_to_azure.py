#!/usr/bin/env python3
"""
Upload match data from JSON backups to Azure Tables storage.
Transforms JSON format to Azure Tables schema and handles batch uploads.

Usage:
    python upload_to_azure.py --file backup-data/2026/2026-04/2026-04-28.json \
                               --connection-string "DefaultEndpointsProtocol=https;..."
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List, Dict, Any

from azure.data.tables import TableClient
from azure.core.exceptions import ResourceExistsError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Upload match backup JSON to Azure Tables storage.'
    )
    parser.add_argument(
        '--file', required=True,
        metavar='PATH',
        help='Path to the JSON backup file (e.g. backup-data/2026/2026-04/2026-04-28.json)'
    )
    parser.add_argument(
        '--connection-string', required=True,
        metavar='CONN_STR',
        help='Azure Storage connection string'
    )
    return parser.parse_args()


def load_json_data(file_path: str) -> Dict[str, Any]:
    """Load and parse JSON backup file."""
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
        return data
    except FileNotFoundError:
        print(f"ERROR: JSON file not found: {file_path}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in file {file_path}: {e}")
        sys.exit(1)


def transform_matches(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Transform JSON matches to Azure Tables format."""
    required_top_level = ['backup_timestamp', 'match_date', 'matches']
    for key in required_top_level:
        if key not in data:
            raise ValueError(f"Missing required field in JSON: {key}")
    
    required_match_fields = [
        'Date', 'RoundNumber', 'ScoreTeam1', 'ScoreTeam2',
        'Team1Player1Name', 'Team1Player2Name',
        'Team2Player1Name', 'Team2Player2Name'
    ]
    
    matches = data['matches']
    if not isinstance(matches, list):
        raise ValueError("'matches' field must be a list")
    
    transformed = []
    timestamp = data['backup_timestamp']
    
    for match_index, match in enumerate(matches, 1):
        for field in required_match_fields:
            if field not in match:
                raise ValueError(
                    f"Match at index {match_index} missing required field: {field}"
                )
        
        date_str = match['Date']
        round_num = match['RoundNumber']
        row_key = f"{date_str}_R{round_num}M{match_index}"
        
        entity = {
            'PartitionKey': 'match',
            'RowKey': row_key,
            'Timestamp': timestamp,
            'Date': date_str,
            'RoundNumber': int(match['RoundNumber']),
            'ScoreTeam1': int(match['ScoreTeam1']),
            'ScoreTeam2': int(match['ScoreTeam2']),
            'Team1Player1Name': match['Team1Player1Name'],
            'Team1Player2Name': match['Team1Player2Name'],
            'Team2Player1Name': match['Team2Player1Name'],
            'Team2Player2Name': match['Team2Player2Name'],
        }
        transformed.append(entity)
    
    return transformed


def upload_to_azure(connection_string: str, entities: List[Dict[str, Any]]) -> None:
    """Upload entities to Azure Tables in batches."""
    try:
        table_client = TableClient.from_connection_string(
            connection_string, table_name='Matches'
        )
    except Exception as e:
        print(f"ERROR: Failed to connect to Azure Tables: {e}")
        sys.exit(1)
    
    batch_size = 100
    total_uploaded = 0
    
    for i in range(0, len(entities), batch_size):
        batch = entities[i:i + batch_size]
        
        try:
            operations = [('upsert', entity, {'mode': 'replace'}) for entity in batch]
            table_client.submit_transaction(operations)
            
            total_uploaded += len(batch)
            print(f"Uploaded {len(batch)} entities (total: {total_uploaded}/{len(entities)})")
        
        except ResourceExistsError as e:
            print(f"ERROR: Entity already exists (duplicate RowKey): {e}")
            sys.exit(1)
        except Exception as e:
            print(f"ERROR: Failed to upload batch at offset {i}: {e}")
            sys.exit(1)
    
    print(f"SUCCESS: Uploaded {total_uploaded} entities to Matches table")


def main():
    """Main entry point."""
    args = parse_args()
    file_path = args.file
    connection_string = args.connection_string

    print(f"Loading data from: {file_path}")
    data = load_json_data(file_path)

    print(f"Transforming {len(data.get('matches', []))} matches...")
    entities = transform_matches(data)

    print(f"Uploading {len(entities)} entities to Azure Tables...")
    upload_to_azure(connection_string, entities)


if __name__ == '__main__':
    main()
