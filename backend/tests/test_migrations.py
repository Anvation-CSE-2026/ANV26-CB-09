from uuid import uuid4
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from backend.app.config import settings
from backend.app.database import Base


def test_fresh_database_migrations_match_current_schema():
    schema = "lens_migration_" + uuid4().hex
    admin = create_engine(settings.database_url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = create_engine(settings.database_url, connect_args={"options": f"-c search_path={schema}"})
    try:
        with isolated.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            inspector = inspect(connection)
            assert set(inspector.get_table_names()) == set(Base.metadata.tables) | {"alembic_version"}
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "006"
            for table in Base.metadata.tables.values():
                columns = {c["name"]: c for c in inspector.get_columns(table.name)}
                assert set(columns) == set(table.columns.keys())
                for column in table.columns:
                    assert columns[column.name]["nullable"] == column.nullable
                expected_fks = {(tuple(c.parent.name for c in fk.elements), fk.referred_table.name) for fk in table.foreign_key_constraints}
                actual_fks = {(tuple(fk["constrained_columns"]), fk["referred_table"]) for fk in inspector.get_foreign_keys(table.name)}
                assert actual_fks == expected_fks
    finally:
        isolated.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
