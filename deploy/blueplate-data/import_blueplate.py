#!/usr/bin/env python3
"""Import the committed BluePlate JSON snapshots into its dedicated MySQL schema.

The importer writes only dashboard_sections/dashboard_rows in the fixed BluePlate
schema. Existing data is accepted only when every imported value matches exactly.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


SCHEMA = '2026_3dsa_3_blueplate'
DATASETS = ('blueplate', 'orders')
SECTIONS_TABLE = 'dashboard_sections'
ROWS_TABLE = 'dashboard_rows'
INSERT_CHUNK = 250


class ImportErrorSafe(Exception):
    pass


def load_snapshots(source_dir):
    snapshots = {}
    for dataset, filename in zip(DATASETS, ('blueplate.json', 'orders.json')):
        path = source_dir / filename
        try:
            with path.open('r', encoding='utf-8') as handle:
                value = json.load(handle)
        except (OSError, UnicodeError, json.JSONDecodeError):
            raise ImportErrorSafe(f'Cannot read valid UTF-8 JSON snapshot: {filename}') from None
        if not isinstance(value, dict) or not all(isinstance(k, str) for k in value):
            raise ImportErrorSafe(f'Snapshot must be a JSON object with string keys: {filename}')
        if len(value) > 0xFFFF_FFFF or any(not key or len(key) > 32 or not key.isascii() for key in value):
            raise ImportErrorSafe(f'Snapshot section name is outside the supported ASCII range: {filename}')
        snapshots[dataset] = value
    return snapshots


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def sql_hex(value):
    """A UTF-8 SQL expression without quote/backslash interpretation risks."""
    return "CONVERT(0x" + value.encode('utf-8').hex() + ' USING utf8mb4)'


def expected_sections(snapshots):
    for dataset, snapshot in snapshots.items():
        for section, value in snapshot.items():
            is_array = isinstance(value, list)
            yield dataset, section, is_array, None if is_array else value


def expected_rows(snapshots):
    for dataset, snapshot in snapshots.items():
        for section, value in snapshot.items():
            if isinstance(value, list):
                for ordinal, item in enumerate(value):
                    yield dataset, section, ordinal, item


def fixture_report(snapshots):
    sections = sorted(expected_sections(snapshots), key=lambda row: (row[0], row[1]))
    rows = sorted(expected_rows(snapshots), key=lambda row: (row[0], row[1], row[2]))
    array_counts = {
        f'{dataset}.{section}': len(value)
        for dataset, snapshot in snapshots.items()
        for section, value in snapshot.items()
        if isinstance(value, list)
    }
    return sections, rows, array_counts


def mysql_command(mysql, defaults_file, database):
    if defaults_file.is_symlink():
        raise ImportErrorSafe('MySQL defaults file must be a regular private file.')
    path = defaults_file.resolve(strict=True)
    if not path.is_file():
        raise ImportErrorSafe('MySQL defaults file must be a regular private file.')
    if os.name != 'nt' and path.stat().st_mode & 0o077:
        raise ImportErrorSafe('MySQL defaults file permissions must be owner-only.')
    return [mysql, f'--defaults-file={path}', '--no-login-paths', '--default-character-set=utf8mb4',
            '--ssl-mode=VERIFY_IDENTITY', '--binary-mode', '--local-infile=0', '--skip-reconnect',
            '--batch', '--raw', '--skip-column-names', '--database', database]


def run_mysql(command, sql):
    try:
        result = subprocess.run(command, input=sql, text=True, encoding='utf-8',
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=1800, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise ImportErrorSafe('MySQL client could not complete the requested operation.') from None
    if result.returncode:
        raise ImportErrorSafe('MySQL rejected the scoped operation; no row data or credentials were printed.')
    return result.stdout


def json_value(text):
    if text == 'NULL':
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        raise ImportErrorSafe('MySQL returned an invalid stored JSON value.') from None


def verify_existing(command, sections, rows):
    sql = (
        f'SELECT `dataset`,`section`,`is_array`,CAST(`payload` AS CHAR) FROM `{SECTIONS_TABLE}` ORDER BY `dataset`,`section`;\n'
        f'SELECT 1,`dataset`,`section`,`ordinal`,CAST(`payload` AS CHAR) FROM `{ROWS_TABLE}` ORDER BY `dataset`,`section`,`ordinal`;\n'
    )
    output = run_mysql(command, sql)
    lines = output.rstrip('\n').split('\n')
    actual_sections = []
    actual_rows = []
    # JSON values are escaped by MySQL's JSON representation; the ASCII unit
    # separator cannot appear literally in a valid JSON string.
    for line in lines:
        fields = line.split('\t')
        if len(fields) == 4:
            dataset, section, flag, payload = fields
            actual_sections.append((dataset, section, flag == '1', json_value(payload)))
        elif len(fields) == 5:
            _, dataset, section, ordinal, payload = fields
            try:
                actual_rows.append((dataset, section, int(ordinal), json_value(payload)))
            except ValueError:
                raise ImportErrorSafe('MySQL returned an invalid row ordinal.') from None
        elif line.strip():
            raise ImportErrorSafe('MySQL returned an unexpected verification result.')
    if len(actual_sections) != len(sections) or len(actual_rows) != len(rows):
        raise ImportErrorSafe('Target schema contains partial or unrelated dashboard data; refusing to overwrite it.')
    for actual, expected in zip(actual_sections, sections):
        if actual[:3] != expected[:3] or canonical(actual[3]) != canonical(expected[3]):
            raise ImportErrorSafe('Existing section data differs from the committed snapshots; refusing to overwrite it.')
    for actual, expected in zip(actual_rows, rows):
        if actual[:3] != expected[:3] or canonical(actual[3]) != canonical(expected[3]):
            raise ImportErrorSafe('Existing row data differs from the committed snapshots; refusing to overwrite it.')


def import_if_empty(command, sections, rows):
    counts = run_mysql(command,
        f'SELECT COUNT(*) FROM `{SECTIONS_TABLE}`;\nSELECT COUNT(*) FROM `{ROWS_TABLE}`;\n').splitlines()
    try:
        section_count, row_count = map(int, counts)
    except (ValueError, TypeError):
        raise ImportErrorSafe('Could not read target table counts.') from None
    if section_count == len(sections) and row_count == len(rows):
        verify_existing(command, sections, rows)
        return 'verified'
    if section_count or row_count:
        raise ImportErrorSafe('Target schema contains partial or unrelated dashboard data; refusing to overwrite it.')
    run_mysql(command, ''.join(insert_sql(sections, rows)))
    verify_existing(command, sections, rows)
    return 'imported'


def values_clause(values):
    return '(' + ','.join(values) + ')'


def insert_sql(sections, rows):
    yield 'START TRANSACTION;\n'
    section_records = []
    for dataset, section, is_array, payload in sections:
        payload_sql = 'NULL' if is_array else sql_hex(canonical(payload))
        section_records.append(values_clause([
            sql_hex(dataset), sql_hex(section), '1' if is_array else '0', payload_sql,
        ]))
    for start in range(0, len(section_records), INSERT_CHUNK):
        batch = ','.join(section_records[start:start + INSERT_CHUNK])
        yield f'INSERT INTO `{SECTIONS_TABLE}` (`dataset`,`section`,`is_array`,`payload`) VALUES {batch};\n'
    row_records = []
    for dataset, section, ordinal, payload in rows:
        row_records.append(values_clause([
            sql_hex(dataset), sql_hex(section), str(ordinal), sql_hex(canonical(payload)),
        ]))
        if len(row_records) >= INSERT_CHUNK:
            batch = ','.join(row_records)
            yield f'INSERT INTO `{ROWS_TABLE}` (`dataset`,`section`,`ordinal`,`payload`) VALUES {batch};\n'
            row_records.clear()
    if row_records:
        batch = ','.join(row_records)
        yield f'INSERT INTO `{ROWS_TABLE}` (`dataset`,`section`,`ordinal`,`payload`) VALUES {batch};\n'
    yield 'COMMIT;\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True,
                        help='Directory containing the committed blueplate.json and orders.json snapshots')
    parser.add_argument('--defaults-file', type=Path,
                        help='Owner-only MySQL client defaults file; required unless --validate-only is used')
    parser.add_argument('--mysql', help='Path to the MySQL CLI executable (defaults to mysql on PATH)')
    parser.add_argument('--schema', default=SCHEMA,
                        help=f'Fixed target schema (must equal {SCHEMA})')
    parser.add_argument('--validate-only', action='store_true', help='Check snapshots and print fixture counts without connecting')
    args = parser.parse_args()
    if args.schema != SCHEMA:
        parser.error(f'target schema is fixed to {SCHEMA}')
    try:
        snapshots = load_snapshots(args.source_dir)
        sections, rows, arrays = fixture_report(snapshots)
        if args.validate_only:
            print(f'Validated {len(sections)} sections and {len(rows)} ordered array rows.')
            for key, count in sorted(arrays.items()):
                print(f'{key}: {count}')
            return 0
        if not args.defaults_file:
            parser.error('--defaults-file is required for an import')
        mysql = args.mysql or shutil.which('mysql')
        if not mysql:
            raise ImportErrorSafe('MySQL CLI not found; pass its executable path with --mysql.')
        command = mysql_command(mysql, args.defaults_file, SCHEMA)
        # Duplicated primary keys fail closed if concurrent runs race after
        # preflight. The database transaction rolls back the whole insert.
        outcome = import_if_empty(command, sections, rows)
        print(f"{'Imported' if outcome == 'imported' else 'Verified'} {len(sections)} sections and {len(rows)} ordered array rows in {SCHEMA}.")
        return 0
    except ImportErrorSafe as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
