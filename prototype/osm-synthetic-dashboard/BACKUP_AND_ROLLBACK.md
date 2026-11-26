# Backup and rollback

Before any migration, use a backup-capable account with SELECT and SHOW VIEW and any privileges required for stored objects. Save a restricted backup outside the repository. Use an interactive password prompt or protected option file.

```sh
umask 077
mysqldump --host="$DB_HOST" --user="$BACKUP_USER" --password \
  --single-transaction --skip-lock-tables --no-tablespaces \
  --set-gtid-purged=OFF --routines --events --triggers blueplate_dw > "$BACKUP"
sha256sum "$BACKUP"
```

For RDS add the applicable --ssl-ca and --ssl-mode=VERIFY_IDENTITY. Restore into a separate MySQL 8.0 instance and compare object inventory, stable restaurant keys, modeled fact totals, and report counts. Keep backups and genuine report contents private.

For service rollback, point staging at the previous compatible application and use its prior configuration. Disable the versioned current-model flag where needed. Additive tables can remain for audit if the previous connector is compatible. Do not restore an old dump over newer genuine reports. Recover a backup in isolation first and reconcile newer authorized records before any database replacement. MySQL DDL may commit by statement.
