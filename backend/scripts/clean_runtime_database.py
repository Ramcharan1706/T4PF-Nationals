"""Remove fictional/dev runtime records while preserving the static reference
content (curriculum word library and tongue-placement guidance) that
``SQLiteRepository._seed_if_empty`` itself is allowed to ship.

This is intentionally an explicit maintenance command, not an application-startup
migration. Back up the SQLite file before running it.
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

PRESERVED_ENTITIES = ("curriculum", "tongue_placements")


def clean_database(path: Path) -> dict[str, int]:
    connection = sqlite3.connect(path)
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        placeholders = ",".join("?" for _ in PRESERVED_ENTITIES)
        entities = [
            row[0]
            for row in connection.execute(
                f"SELECT DISTINCT entity FROM records WHERE entity NOT IN ({placeholders})",
                PRESERVED_ENTITIES,
            ).fetchall()
        ]
        counts = {
            entity: connection.execute(
                "SELECT COUNT(*) FROM records WHERE entity = ?", (entity,)
            ).fetchone()[0]
            for entity in entities
        }
        connection.execute(
            f"DELETE FROM records WHERE entity NOT IN ({placeholders})", PRESERVED_ENTITIES
        )
        connection.execute("DELETE FROM credentials")
        connection.commit()
        return counts
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, help="SQLite database file to clean")
    args = parser.parse_args()
    if not args.database.is_file():
        raise SystemExit(f"Database does not exist: {args.database}")
    counts = clean_database(args.database)
    print(f"Preserved curriculum records; removed: {counts or 'no non-curriculum records'}")


if __name__ == "__main__":
    main()
