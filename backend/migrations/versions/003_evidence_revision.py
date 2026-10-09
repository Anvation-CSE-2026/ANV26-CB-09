"""Separate evidence versions from concurrent case review versions."""
from alembic import op
revision = "003"
down_revision = "002"


def upgrade():
    op.execute("ALTER TABLE workspace_cases ADD COLUMN IF NOT EXISTS evidence_revision INTEGER NOT NULL DEFAULT 1")


def downgrade():
    raise RuntimeError("Evidence history must be retained.")
