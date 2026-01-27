#!/usr/bin/env python3
"""Seed test data for development."""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select

from backend.models.database import User, async_session, init_db


async def seed_users():
    """Seed test users."""
    test_users = [
        "admin",
        "annotator1",
        "annotator2",
        "reviewer",
    ]

    async with async_session() as session:
        for username in test_users:
            # Check if already exists
            result = await session.execute(
                select(User).where(User.username == username)
            )
            existing = result.scalar_one_or_none()

            if existing is not None:
                print(f"  Skipping user '{username}' (already exists)")
                continue

            user = User(username=username)
            session.add(user)
            print(f"  Created user '{username}'")

        await session.commit()


async def main():
    """Main seed function."""
    print("Initializing database...")
    await init_db()

    print("\nSeeding users...")
    await seed_users()

    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
