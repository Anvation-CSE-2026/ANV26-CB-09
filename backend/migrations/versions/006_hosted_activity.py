"""Scoped expiring links for consented first-party hosted activity."""
from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("hosted_access",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organisation_id", sa.String(36), sa.ForeignKey("organisations.id"), nullable=False),
        sa.Column("case_id", sa.String(36), sa.ForeignKey("workspace_cases.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("session_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("browser_token", sa.String(100), nullable=True),
        sa.Column("summary", sa.JSON(), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False))
    op.create_index("ix_hosted_access_organisation_id", "hosted_access", ["organisation_id"])
    op.create_index("ix_hosted_access_case_id", "hosted_access", ["case_id"])


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled. Restore into a new database instead.")
