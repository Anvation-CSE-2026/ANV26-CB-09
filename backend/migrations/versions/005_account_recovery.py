"""Verified account recovery emails and ephemeral single-use actions."""
from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("recovery_emails",
        sa.Column("account_id", sa.String(36), sa.ForeignKey("accounts.id"), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("email_actions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("purpose", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_email_actions_account_id", "email_actions", ["account_id"])


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled. Restore into a new database instead.")
