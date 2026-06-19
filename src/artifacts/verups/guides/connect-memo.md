# AWS Secrets Manager — Database Connection Commands

**Requirements:** AWS CLI · jq · mysql · psql · redis-cli · VPN / Bastion access

---

## Table of Contents

### Exchange Project
- [§1 Setup (Exchange)](#1-setup-exchange)
- [§2 MySQL Connection](#2-mysql-connection-exchange)
- [§3 Export CSV — MySQL](#3-export-csv-mysql-exchange)
- [§4 Helper Functions](#4-helper-functions-exchange)
- [§5 Redshift (psql)](#5-redshift-exchange)
  - [§5.1 Connect](#51-redshift-connection)
  - [§5.2 Export CSV](#52-export-csv-from-redshift-exchange)
  - [§5.3 Helper Functions](#53-redshift-helper-functions-exchange)
  - [§5.4 Redis Connection](#54-redis-connection-exchange)
  - [§5.5 Redis Helper Function](#55-redis-helper-function-exchange)
- [§6 psql Cheat Sheet](#6-psql-cheat-sheet)
- [§7 SQL Syntax Comparison — MySQL vs Redshift](#7-sql-syntax-comparison-mysql-vs-redshift)
- [§8 Important Notes (Exchange)](#8-important-notes-exchange)

### Point / Verup Project
- [§9 Setup (Point / Verup)](#9-setup-point--verup)
- [§10 MySQL Connection](#10-mysql-connection-point)
- [§11 Export CSV — MySQL](#11-export-csv-mysql-point)
- [§12 Helper Functions](#12-helper-functions-point)
- [§13 Redshift (psql)](#13-redshift-point)
  - [§13.1 Connect](#131-redshift-connection-point)
  - [§13.2 Export CSV](#132-export-csv-from-redshift-point)
  - [§13.3 Helper Functions](#133-redshift-helper-functions-point)
  - [§13.4 Redis Connection](#134-redis-connection-point)
  - [§13.5 Redis Helper Function](#135-redis-helper-function-point)
- [§14 Important Notes (Point / Verup)](#14-important-notes-point--verup)

### DDL Dump & S3 Transfer
- [§15 Dump DDL (schema only)](#15-dump-ddl-schema-only)
  - [§15.1 Exchange DDL Dump](#151-exchange-ddl-dump)
  - [§15.2 Point / Verup DDL Dump](#152-point--verup-ddl-dump)
  - [§15.3 Helper Functions](#153-helper-functions-for-ddl-dump)
- [§16 Upload Files to S3](#16-upload-files-to-s3)
  - [§16.1 Upload / Download / List](#161-upload--download--list)
  - [§16.2 Full Workflow: DDL → Compress → S3](#162-full-workflow-ddl--compress--s3)
  - [§16.3 Helper Function: DDL + S3](#163-helper-function-ddl-dump--s3-upload)
- [§17 Important Notes (DDL & S3)](#17-important-notes-ddl-dump--s3-transfer)

### Database Size Statistics
- [§18 Database Size Statistics (MySQL / Aurora)](#18-database-size-statistics-mysql--aurora)
  - [§18.1 Total size per database](#181-total-size-per-database)
  - [§18.2 Total size of a specific database](#182-total-size-of-a-specific-database)
  - [§18.3 Top N largest tables ⭐](#183-top-n-largest-tables-)
  - [§18.4 All tables sorted by size](#184-all-tables-sorted-by-size)
  - [§18.5 Size by table name prefix](#185-size-by-table-name-prefix)
  - [§18.6 Per-index breakdown (master_user)](#186-per-index-breakdown-requires-master_user)
  - [§18.7 Empty tables consuming space](#187-empty-tables-consuming-space)
  - [§18.8 Index-heavy tables](#188-index-heavy-tables)
  - [§18.9 Recently updated tables](#189-recently-updated-tables)
  - [§18.10 One-liners (from shell)](#1810-one-liners-from-shell)
  - [§18.11 Helper functions (pt-size-*)](#1811-helper-functions-pt-size-)
- [§19 CloudWatch Storage (Aurora cluster-level)](#19-cloudwatch-storage-aurora-cluster-level)
  - [§19.1 Get current storage used](#191-get-current-storage-used)
  - [§19.2 Raw dump (all datapoints)](#192-raw-dump-all-datapoints-in-24h-window)
  - [§19.3 Check metric exists / list dimensions](#193-check-metric-exists--list-dimensions)
  - [§19.4 List clusters and global clusters](#194-list-clusters-and-global-clusters)
  - [§19.5 Helper function (pt-storage)](#195-helper-function-pt-storage)
- [§20 Important Notes (Size Statistics)](#20-important-notes-size-statistics)

---

## Exchange Project

---

## §1 Setup (Exchange)

```bash
# Set AWS profile (choose one)
export AWS_PROFILE=cb-exchange-dev   # Development
export AWS_PROFILE=cb-exchange-stg   # Staging
export AWS_PROFILE=cb-exchange-prd   # Production

export AWS_REGION=ap-northeast-1
```

> **Note:** If running from bastion host, the instance role is used automatically.
> The `_aws_setup` helper function in [§4](#4-helper-functions-exchange) auto-detects bastion role vs local profile.

**Available secrets:**

| Secret ID | Access Level |
|-----------|-------------|
| `exchange/aurora/master_user` | Master (full access) |
| `exchange/aurora/viewer_user` | Viewer — read-only, for users (**recommended**) |
| `exchange/aurora/editor_user` | Editor — read/write, for users |
| `exchange/aurora/viewer_service` | Viewer Service — read-only, for services |
| `exchange/aurora/editor_service` | Editor Service — read/write, for services |
| `exchange/SPRING_DATA_REDIS` | Redis host + port |

---

## §2 MySQL Connection (Exchange)

```bash
# VIEWER USER (Read-only — RECOMMENDED)
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)"

# EDITOR USER (Read/Write)
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/editor_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)"

# MASTER USER (Full access — USE ONLY WHEN NECESSARY)
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/master_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)"
```

---

## §3 Export CSV — MySQL (Exchange)

```bash
# Export a table to CSV
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" --batch -e "SELECT * FROM balance_notify_config" | sed 's/\t/,/g' > balance_notify_config.csv

# Export with timestamp in filename
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" --batch -e "SELECT * FROM [TABLE_NAME]" | sed 's/\t/,/g' > [TABLE_NAME]_$(date +%Y%m%d).csv

# Export with WHERE condition
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" --batch -e "SELECT * FROM [TABLE_NAME] WHERE created_at >= '2026-01-01'" | sed 's/\t/,/g' > output.csv

# Export specific columns only
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" --batch -e "SELECT id, name, status FROM [TABLE_NAME]" | sed 's/\t/,/g' > output.csv
```

---

## §4 Helper Functions (Exchange)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Auto-detect bastion role vs local AWS profile
_aws_setup() {
  local profile=$1
  export AWS_REGION=ap-northeast-1
  if aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null | grep -q 'assumed-role'; then
    unset AWS_PROFILE
    echo "[bastion] Using assumed role"
  else
    export AWS_PROFILE=$profile
    echo "[local] Using profile: $profile"
  fi
}

cb-mysql() {
  local env=${1:-prd}
  local user=${2:-viewer_user}
  _aws_setup "cb-exchange-$env"
  SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/$user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)"
}

cb-export() {
  local table=$1
  local env=${2:-prd}
  local user=${3:-viewer_user}
  _aws_setup "cb-exchange-$env"
  SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/$user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" -e "SELECT * FROM $table" | sed 's/\t/,/g' > ${table}_$(date +%Y%m%d).csv
}
```

**Usage:**

```bash
cb-mysql                        # Production with viewer_user
cb-mysql prd                    # Production with viewer_user
cb-mysql stg                    # Staging with viewer_user
cb-mysql prd master_user        # Production with master_user
cb-export balance_notify_config # Export table from Production
```

---

## §5 Redshift (Exchange)

Redshift uses the PostgreSQL protocol — connect with `psql`.  
Default port: **5439** (different from PostgreSQL standard 5432).

**Available secrets:**

| Secret ID | Format | Access Level |
|-----------|--------|-------------|
| `exchange/redshift/master_user` | JSON | Master (full access) |
| `exchange/SPRING_DATASOURCE_HISTORICAL` | JDBC URL | Application use |

### §5.1 Redshift Connection

```bash
# MASTER USER
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/redshift/master_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "exchange"')"
```

### §5.2 Export CSV from Redshift (Exchange)

```bash
# Export a table to CSV
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/redshift/master_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "exchange"')" -c "COPY (SELECT * FROM [TABLE_NAME]) TO STDOUT WITH CSV HEADER" > [TABLE_NAME]_$(date +%Y%m%d).csv

# Export with WHERE condition
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/redshift/master_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "exchange"')" -c "\COPY (SELECT * FROM [TABLE_NAME] WHERE created_at >= '2026-01-01') TO '[TABLE_NAME]_output.csv' WITH CSV HEADER"

# Simple export with -A -F (tab-separated, similar to MySQL --batch)
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/redshift/master_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "exchange"')" -A -F',' -c "SELECT * FROM [TABLE_NAME]" > [TABLE_NAME]_$(date +%Y%m%d).csv
```

### §5.3 Redshift Helper Functions (Exchange)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
cb-redshift() {
  local env=${1:-prd}
  local user=${2:-master_user}
  _aws_setup "cb-exchange-$env"
  SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/redshift/$user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "exchange"')"
}

cb-redshift-export() {
  local table=$1
  local env=${2:-prd}
  local user=${3:-master_user}
  _aws_setup "cb-exchange-$env"
  SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/redshift/$user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "exchange"')" -A -F',' -c "SELECT * FROM $table" > ${table}_$(date +%Y%m%d).csv
}
```

**Usage:**

```bash
cb-redshift                                    # Production with master_user
cb-redshift prd                                # Production with master_user
cb-redshift stg                                # Staging with master_user
cb-redshift prd viewer_user                    # Production with viewer_user
cb-redshift-export pos_trade                   # Export table from Production
cb-redshift-export pos_trade stg               # Export table from Staging
cb-redshift-export pos_trade prd viewer_user   # Export with viewer_user
```

### §5.4 Redis Connection (Exchange)

Secret: `exchange/SPRING_DATA_REDIS` — keys: `SPRING_DATA_REDIS_HOST`, `SPRING_DATA_REDIS_PORT`  
No password (ElastiCache AUTH is not enabled on Exchange).

```bash
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/SPRING_DATA_REDIS --query SecretString --output text) && redis-cli -h "$(echo "$SECRET" | jq -r '.SPRING_DATA_REDIS_HOST')" -p "$(echo "$SECRET" | jq -r '.SPRING_DATA_REDIS_PORT')"
```

### §5.5 Redis Helper Function (Exchange)

```bash
cb-redis() {
  local env=${1:-prd}
  _aws_setup "cb-exchange-$env"
  SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/SPRING_DATA_REDIS --query SecretString --output text)
  local host=$(echo "$SECRET" | jq -r '.SPRING_DATA_REDIS_HOST')
  local port=$(echo "$SECRET" | jq -r '.SPRING_DATA_REDIS_PORT')
  echo "Connecting to Redis: $host:$port"
  redis-cli -h "$host" -p "$port"
}
```

**Usage:**

```bash
cb-redis       # Production
cb-redis prd   # Production
cb-redis stg   # Staging
cb-redis dev   # Development
```

---

## §6 psql Cheat Sheet

### §6.1 Basic controls

| psql | mysql equivalent |
|------|-----------------|
| `\q` | `quit` / `exit` |
| `\?` | List all `\` commands |
| `\h SELECT` | Help syntax for a specific SQL command |

### §6.2 View database / table

| psql | mysql equivalent |
|------|-----------------|
| `\l` | `SHOW DATABASES;` |
| `\c other_db` | `USE other_db;` |
| `\dt` | `SHOW TABLES;` |
| `\dt spot_*` | List tables matching pattern |
| `\d pos_trade` | `DESCRIBE pos_trade;` |
| `\d+ pos_trade` | More detail (size, storage) |

### §6.3 Run queries

```sql
-- Normal query
SELECT COUNT(*) FROM pos_trade;

-- Multi-line (Enter for new line, ; to execute)
SELECT COUNT(*)
FROM pos_trade
WHERE created_at >= current_date - INTERVAL '3 months';
```

| Action | Command |
|--------|---------|
| Cancel current query | `Ctrl+C` |
| Toggle execution timing | `\timing` |

### §6.4 Display results

```sql
-- View results vertically (like mysql \G)
\x on
SELECT * FROM pos_trade LIMIT 1;
\x off

-- Disable pager (show all in terminal)
\pset pager off
```

### §6.5 History & utilities

| psql | mysql equivalent |
|------|-----------------|
| `\s` | `Ctrl+R` to search history |
| `↑ Arrow` | Previous query |
| `\i /path/to/query.sql` | `source /path/to/query.sql` |
| `\o output.txt` + query + `\o` | Redirect output to file |

### §6.6 Quick comparison: mysql ↔ psql

| mysql | psql |
|-------|------|
| `quit` / `exit` | `\q` |
| `SHOW DATABASES;` | `\l` |
| `USE db_name;` | `\c db_name` |
| `SHOW TABLES;` | `\dt` |
| `DESCRIBE table;` | `\d table` |
| `source file.sql` | `\i file.sql` |
| `\G` (vertical) | `\x on` |
| `SHOW CREATE TABLE t;` | `\d+ t` (similar, not exact) |

---

## §7 SQL Syntax Comparison: MySQL vs Redshift

| Feature | MySQL (Aurora) | Redshift (psql) |
|---------|---------------|-----------------|
| Client | `mysql` | `psql` |
| Port | 3306 | 5439 |
| Password flag | `-p"password"` | `PGPASSWORD="password"` |
| Execute query | `-e "SQL"` | `-c "SQL"` |
| Batch mode | `--batch` | `-A` (unaligned) `-t` (tuples only) |
| CSV export | `--batch` + `sed` | `\COPY ... TO STDOUT WITH CSV` |
| Date interval | `INTERVAL 3 MONTH` | `INTERVAL '3 months'` |
| Secret prefix | `exchange/aurora/*` | `exchange/redshift/master_user` |

---

## §8 Important Notes (Exchange)

> ⚠️ **Always use `viewer_user`** for exporting/reading data on RDS.

- Redshift currently only has `master_user`
- Requires VPN connection or running from bastion host
- **DO NOT** commit credentials to git
- Delete CSV files after use
- Install psql client: `brew install libpq && brew link --force libpq`
- Install redis-cli: `brew install redis`

---

## Point / Verup Project

Point and Verup share the same database.  
Always run from **bastion host** (uses instance IAM role — no AWS profile needed).

---

## §9 Setup (Point / Verup)

```bash
# No AWS profile needed — bastion host IAM role is used directly
export AWS_REGION=ap-northeast-1
```

**Available secrets:**

| Secret ID | Access Level |
|-----------|-------------|
| `point/aurora/master_user` | Master (full access) |
| `point/aurora/viewer_user` | Viewer — read-only, for users (**recommended**) |
| `point/aurora/editor_user` | Editor — read/write, for users |
| `point/aurora/viewer_service` | Viewer Service — read-only, for services |
| `point/aurora/editor_service` | Editor Service — read/write, for services |
| `point/SPRING_DATA_REDIS` | Redis host, port, SSL flag |
| `point/redshift/master_user` | Redshift master |
| `point/redshift/viewer_user` | Redshift viewer |
| `point/redshift/editor_user` | Redshift editor |

---

## §10 MySQL Connection (Point)

```bash
# VIEWER USER (Read-only — RECOMMENDED)
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)"

# EDITOR USER (Read/Write)
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/editor_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)"

# MASTER USER (Full access — USE ONLY WHEN NECESSARY)
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/master_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)"
```

---

## §11 Export CSV — MySQL (Point)

```bash
# Export a table to CSV
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" --batch -e "SELECT * FROM [TABLE_NAME]" | sed 's/\t/,/g' > [TABLE_NAME]_$(date +%Y%m%d).csv

# Export with WHERE condition
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" --batch -e "SELECT * FROM [TABLE_NAME] WHERE created_at >= '2026-01-01'" | sed 's/\t/,/g' > output.csv

# Export specific columns only
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" --batch -e "SELECT id, name, status FROM [TABLE_NAME]" | sed 's/\t/,/g' > output.csv
```

---

## §12 Helper Functions (Point)

> **Note:** Point/Verup always runs from bastion host — no AWS profile arg needed.

Add to `~/.bashrc` or `~/.zshrc`:

```bash
pt-mysql() {
  local user=${1:-viewer_user}
  export AWS_REGION=ap-northeast-1
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/$user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)"
}

pt-export() {
  local table=$1
  local user=${2:-viewer_user}
  export AWS_REGION=ap-northeast-1
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/$user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" -e "SELECT * FROM $table" | sed 's/\t/,/g' > ${table}_$(date +%Y%m%d).csv
}
```

**Usage:**

```bash
pt-mysql                 # Connect with viewer_user
pt-mysql master_user     # Connect with master_user
pt-export users          # Export table with viewer_user
```

---

## §13 Redshift (Point)

Redshift uses PostgreSQL protocol — connect with `psql`. Default port: **5439**.

### §13.1 Redshift Connection (Point)

```bash
# VIEWER USER (Read-only — RECOMMENDED)
SECRET=$(aws secretsmanager get-secret-value --secret-id point/redshift/viewer_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "point"')"

# EDITOR USER (Read/Write)
SECRET=$(aws secretsmanager get-secret-value --secret-id point/redshift/editor_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "point"')"

# MASTER USER (Full access — USE ONLY WHEN NECESSARY)
SECRET=$(aws secretsmanager get-secret-value --secret-id point/redshift/master_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "point"')"
```

### §13.2 Export CSV from Redshift (Point)

```bash
# Export a table to CSV
SECRET=$(aws secretsmanager get-secret-value --secret-id point/redshift/master_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "point"')" -c "COPY (SELECT * FROM [TABLE_NAME]) TO STDOUT WITH CSV HEADER" > [TABLE_NAME]_$(date +%Y%m%d).csv

# Export with WHERE condition
SECRET=$(aws secretsmanager get-secret-value --secret-id point/redshift/master_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "point"')" -c "\COPY (SELECT * FROM [TABLE_NAME] WHERE created_at >= '2026-01-01') TO '[TABLE_NAME]_output.csv' WITH CSV HEADER"

# Simple export with -A -F
SECRET=$(aws secretsmanager get-secret-value --secret-id point/redshift/master_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "point"')" -A -F',' -c "SELECT * FROM [TABLE_NAME]" > [TABLE_NAME]_$(date +%Y%m%d).csv
```

### §13.3 Redshift Helper Functions (Point)

```bash
pt-redshift() {
  local user=${1:-master_user}
  export AWS_REGION=ap-northeast-1
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/redshift/$user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "point"')"
}

pt-redshift-export() {
  local table=$1
  export AWS_REGION=ap-northeast-1
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/redshift/master_user --query SecretString --output text) && PGPASSWORD="$(echo "$SECRET" | jq -r '.password')" psql -h "$(echo "$SECRET" | jq -r '.host')" -p 5439 -U "$(echo "$SECRET" | jq -r '.username')" -d "$(echo "$SECRET" | jq -r '.dbname // "point"')" -A -F',' -c "SELECT * FROM $table" > ${table}_$(date +%Y%m%d).csv
}
```

**Usage:**

```bash
pt-redshift               # Connect with master_user
pt-redshift viewer_user   # Connect with viewer_user
pt-redshift-export users  # Export table from Redshift
```

### §13.4 Redis Connection (Point)

Secret: `point/SPRING_DATA_REDIS` — keys: `SPRING_DATA_REDIS_HOST`, `SPRING_DATA_REDIS_PORT`, `SPRING_DATA_REDIS_SSL`  
No password. **SSL/TLS is enabled** (`transit_encryption_enabled = true`).

```bash
SECRET=$(aws secretsmanager get-secret-value --secret-id point/SPRING_DATA_REDIS --query SecretString --output text) && redis-cli --tls -h "$(echo "$SECRET" | jq -r '.SPRING_DATA_REDIS_HOST')" -p "$(echo "$SECRET" | jq -r '.SPRING_DATA_REDIS_PORT')"
```

### §13.5 Redis Helper Function (Point)

```bash
pt-redis() {
  export AWS_REGION=ap-northeast-1
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/SPRING_DATA_REDIS --query SecretString --output text)
  local host=$(echo "$SECRET" | jq -r '.SPRING_DATA_REDIS_HOST')
  local port=$(echo "$SECRET" | jq -r '.SPRING_DATA_REDIS_PORT')
  local ssl=$(echo "$SECRET" | jq -r '.SPRING_DATA_REDIS_SSL')
  echo "Connecting to Redis: $host:$port (SSL=$ssl)"
  if [ "$ssl" = "true" ]; then
    redis-cli --tls -h "$host" -p "$port"
  else
    redis-cli -h "$host" -p "$port"
  fi
}
```

**Usage:**

```bash
pt-redis   # Connect to Redis (auto-detects SSL from secret)
```

---

## §14 Important Notes (Point / Verup)

| Rule | Exchange | Point / Verup |
|------|----------|--------------|
| Run environment | Local + bastion | **Bastion host only** (IAM role auto-detected) |
| AWS profile | Required (`cb-exchange-<env>`) | Not needed (`export AWS_REGION=...` only) |
| Recommended MySQL user | `viewer_user` | `viewer_user` |
| Redshift users available | `master_user` only | `master_user`, `viewer_user`, `editor_user` |
| Redis TLS | ❌ Not enabled | ✅ Enabled (`--tls` required) |
| Shared DB | No | Point and Verup share the same DB |

> ⚠️ **DO NOT** commit credentials to git. Delete CSV files after use.

---

## DDL Dump & S3 Transfer

---

## §15 Dump DDL (Schema Only)

```
mysqldump --no-data    # DDL only: CREATE TABLE, INDEX, CONSTRAINT ...
--no-tablespaces       # Skip PROCESS privilege requirement
--single-transaction   # Consistent snapshot without locking (safe for viewer_user)
--skip-lock-tables     # viewer_user may not have LOCK TABLES privilege
--routines             # Include stored procedures/functions
--triggers             # Include triggers
--events               # Include scheduled events
```

> **Note (Point/Verup):** `viewer_user` can only see `point` and `information_schema`.
> For other databases (`point_stg_check`, `cb_stg_check`, etc.), use `master_user`.

### §15.1 Exchange DDL Dump

```bash
# Using viewer_user (recommended)
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/viewer_user --query SecretString --output text) && mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" > exchange_ddl_$(date +%Y%m%d).sql

# Dump a specific database (not the default dbname in secret)
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/viewer_user --query SecretString --output text) && mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" [DATABASE_NAME] > [DATABASE_NAME]_ddl_$(date +%Y%m%d).sql

# If viewer_user lacks permissions, use master_user
SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/master_user --query SecretString --output text) && mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" > exchange_ddl_$(date +%Y%m%d).sql
```

### §15.2 Point / Verup DDL Dump

```bash
# Using viewer_user (recommended)
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" "$(echo $SECRET | jq -r .dbname)" > point_ddl_$(date +%Y%m%d).sql

# Dump a specific database
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" [DATABASE_NAME] > [DATABASE_NAME]_ddl_$(date +%Y%m%d).sql

# Dump only specific tables
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" [DATABASE_NAME] table1 table2 > tables_ddl_$(date +%Y%m%d).sql

# If viewer_user lacks permissions, use master_user
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/master_user --query SecretString --output text) && mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" [DATABASE_NAME] > [DATABASE_NAME]_ddl_$(date +%Y%m%d).sql
```

### §15.3 Helper Functions for DDL Dump

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Exchange
cb-ddl() {
  local db=$1
  local env=${2:-prd}
  local user=${3:-viewer_user}
  _aws_setup "cb-exchange-$env"
  SECRET=$(aws secretsmanager get-secret-value --secret-id exchange/aurora/$user --query SecretString --output text)
  local actual_db=${db:-$(echo $SECRET | jq -r .dbname)}
  local outfile="${actual_db}_ddl_$(date +%Y%m%d).sql"
  mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events \
    -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" \
    -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" \
    "$actual_db" > "$outfile"
  echo "DDL dumped to: $outfile"
}

# Point / Verup
pt-ddl() {
  local db=$1
  local user=${2:-viewer_user}
  export AWS_REGION=ap-northeast-1
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/$user --query SecretString --output text)
  local actual_db=${db:-$(echo $SECRET | jq -r .dbname)}
  local outfile="${actual_db}_ddl_$(date +%Y%m%d).sql"
  mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events \
    -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" \
    -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" \
    "$actual_db" > "$outfile"
  echo "DDL dumped to: $outfile"
}
```

**Usage:**

```bash
cb-ddl                               # Dump default DB (Exchange, Production)
cb-ddl exchange_check stg            # Dump specific DB (Staging)
pt-ddl                               # Dump default DB (Point)
pt-ddl point_stg_check               # Dump specific DB
pt-ddl point_stg_check master_user   # Use master_user if viewer lacks perms
```

---

## §16 Upload Files to S3

S3 buckets for temporary file transfers:

| Environment | Bucket path | AWS Profile |
|-------------|-------------|-------------|
| STG | `s3://infra-bucket-stg-ex/tmp-transfer/` | `cb-exchange-stg` |
| DEV | `s3://infra-bucket-dev-ex/tmp-transfer/` | `cb-exchange-dev` |

### §16.1 Upload / Download / List

```bash
# Upload a file
aws s3 cp [FILE_NAME] s3://infra-bucket-stg-ex/tmp-transfer/

# Upload with gzip compression
gzip [FILE_NAME] && aws s3 cp [FILE_NAME].gz s3://infra-bucket-stg-ex/tmp-transfer/

# Upload and verify
aws s3 cp [FILE_NAME] s3://infra-bucket-stg-ex/tmp-transfer/ && aws s3 ls s3://infra-bucket-stg-ex/tmp-transfer/

# Download from S3
aws s3 cp s3://infra-bucket-stg-ex/tmp-transfer/[FILE_NAME] .

# List files in bucket
aws s3 ls s3://infra-bucket-stg-ex/tmp-transfer/

# Delete a file from S3 (clean up after use)
aws s3 rm s3://infra-bucket-stg-ex/tmp-transfer/[FILE_NAME]
```

### §16.2 Full Workflow: DDL → Compress → S3

```bash
# Step 1: Dump DDL
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" point_stg_check > point_stg_check_ddl_$(date +%Y%m%d).sql

# Step 2: Compress
gzip point_stg_check_ddl_$(date +%Y%m%d).sql

# Step 3: Upload to S3
aws s3 cp point_stg_check_ddl_$(date +%Y%m%d).sql.gz s3://infra-bucket-stg-ex/tmp-transfer/

# Step 4: Verify upload
aws s3 ls s3://infra-bucket-stg-ex/tmp-transfer/

# Step 5: Clean up local file
rm -f point_stg_check_ddl_$(date +%Y%m%d).sql.gz
```

### §16.3 Helper Function: DDL Dump + S3 Upload

All-in-one: dump DDL → gzip → upload to S3 → clean up local file.

```bash
pt-ddl-s3() {
  local db=$1
  local s3path=${2:-s3://infra-bucket-stg-ex/tmp-transfer}
  local user=${3:-viewer_user}
  if [ -z "$db" ]; then
    echo "Usage: pt-ddl-s3 <database> [s3://bucket/prefix] [user]"
    echo "  pt-ddl-s3 point_stg_check"
    echo "  pt-ddl-s3 point_stg_check s3://infra-bucket-dev-ex/tmp-transfer"
    echo "  pt-ddl-s3 point_stg_check s3://infra-bucket-stg-ex/tmp-transfer master_user"
    return 1
  fi
  export AWS_REGION=ap-northeast-1
  local outfile="${db}_ddl_$(date +%Y%m%d).sql"
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/$user --query SecretString --output text) && \
    mysqldump --no-data --no-tablespaces --single-transaction --skip-lock-tables --routines --triggers --events \
      -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" \
      -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" \
      "$db" > "$outfile" && \
    gzip "$outfile" && \
    aws s3 cp "${outfile}.gz" "${s3path}/" && \
    echo "Done: ${s3path}/${outfile}.gz" && \
    rm -f "${outfile}.gz" && echo "Local file cleaned up."
}
```

**Usage:**

```bash
pt-ddl-s3 point_stg_check
pt-ddl-s3 point_stg_check s3://infra-bucket-dev-ex/tmp-transfer
pt-ddl-s3 point_stg_check s3://infra-bucket-stg-ex/tmp-transfer master_user
```

---

## §17 Important Notes (DDL Dump & S3 Transfer)

- Always use `viewer_user` first; switch to `master_user` only if permission error occurs
- Use `--no-data` to avoid accidentally dumping production data
- Compress with gzip before uploading large DDL files
- Clean up files from S3 after use (`tmp-transfer` is not for permanent storage)
- Clean up local files after upload
- **DO NOT** commit DDL files or credentials to git
- Verify upload with: `aws s3 ls s3://[bucket]/[prefix]/`

---

## Database Size Statistics (MySQL / Aurora)

**Context (Point / Verup):**

| Item | Value |
|------|-------|
| Writer host | `point.cluster-c5ccu4omkyf1.ap-northeast-1.rds.amazonaws.com` |
| Sample DB | `point_stg_check` |
| Engine | Aurora MySQL v3 (MySQL 8.0.28) |

**Column semantics in `information_schema.tables`:**

| Column | Meaning |
|--------|---------|
| `data_length` | Clustered index (PK + row data), bytes |
| `index_length` | Sum of all secondary indexes, bytes |
| `data_free` | **UNRELIABLE on Aurora** (always ~0) — do NOT use for fragmentation |
| `table_rows` | Approximate estimate (InnoDB stats) |

> **VolumeBytesUsed** (CloudWatch) is usually 10–30% larger than `SUM(data_length + index_length)` due to undo log, binlog cache, temp tablespace, and per-table overhead.

---

## §18 Database Size Statistics (MySQL / Aurora)

### §18.1 Total size per database

```sql
SELECT
  table_schema AS db_name,
  COUNT(*)     AS tables,
  ROUND(SUM(data_length)                 / 1024 / 1024 / 1024, 2) AS data_gb,
  ROUND(SUM(index_length)                / 1024 / 1024 / 1024, 2) AS index_gb,
  ROUND(SUM(data_length + index_length)  / 1024 / 1024 / 1024, 2) AS total_gb
FROM information_schema.tables
WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys')
GROUP BY table_schema
ORDER BY total_gb DESC;
```

### §18.2 Total size of a specific database

```sql
-- Replace 'point_stg_check' with your target database
SELECT
  ROUND(SUM(data_length + index_length) / 1024 / 1024 / 1024, 2) AS total_gb,
  ROUND(SUM(data_length)                 / 1024 / 1024 / 1024, 2) AS data_gb,
  ROUND(SUM(index_length)                / 1024 / 1024 / 1024, 2) AS index_gb,
  COUNT(*)        AS tables,
  SUM(table_rows) AS rows_estimate
FROM information_schema.tables
WHERE table_schema = 'point_stg_check';
```

### §18.3 Top N largest tables ⭐

Most useful query for capacity planning.

```sql
SELECT
  table_name,
  engine,
  table_rows,
  ROUND(data_length  / 1024 / 1024, 1) AS data_mb,
  ROUND(index_length / 1024 / 1024, 1) AS index_mb,
  ROUND((data_length + index_length) / 1024 / 1024, 1) AS total_mb,
  ROUND((data_length + index_length) / 1024 / 1024 / 1024, 2) AS total_gb,
  ROUND(index_length / NULLIF(data_length,0) * 100, 1) AS index_pct
FROM information_schema.tables
WHERE table_schema = 'point_stg_check'
ORDER BY (data_length + index_length) DESC
LIMIT 30;
```

### §18.4 All tables sorted by size

```sql
SELECT
  CONCAT(table_schema, '.', table_name) AS tbl,
  FORMAT(table_rows, 0)                 AS rows_est,
  CONCAT(ROUND((data_length+index_length)/1024/1024, 1), ' MB') AS size,
  CONCAT(ROUND(data_length/1024/1024, 1), ' MB')                AS data,
  CONCAT(ROUND(index_length/1024/1024, 1), ' MB')               AS idx,
  engine,
  row_format
FROM information_schema.tables
WHERE table_schema = 'point_stg_check'
ORDER BY (data_length + index_length) DESC;
```

### §18.5 Size by table name prefix

Groups tables by prefix before the first `_`. Useful to see which domain (`admin_*`, `aml_*`, `user_*`, ...) consumes most space.

```sql
SELECT
  SUBSTRING_INDEX(table_name, '_', 1) AS prefix,
  COUNT(*) AS tables,
  ROUND(SUM(data_length+index_length)/1024/1024, 1)      AS total_mb,
  ROUND(SUM(data_length+index_length)/1024/1024/1024, 2) AS total_gb
FROM information_schema.tables
WHERE table_schema = 'point_stg_check'
GROUP BY prefix
ORDER BY total_mb DESC;
```

### §18.6 Per-index breakdown (requires master_user)

> ⚠️ `viewer_user` **cannot** read `mysql.innodb_index_stats`. Use `master_user`.

```sql
-- Replace <table> with a table name from §18.3 output
SELECT
  index_name,
  stat_value * @@innodb_page_size                          AS bytes,
  ROUND(stat_value * @@innodb_page_size / 1024 / 1024, 2)  AS mb
FROM mysql.innodb_index_stats
WHERE database_name = 'point_stg_check'
  AND table_name    = '<table>'
  AND stat_name     = 'size'
ORDER BY bytes DESC;
```

`stat_name` glossary:

| Value | Meaning |
|-------|---------|
| `size` | Total pages of the index |
| `n_leaf_pages` | Leaf pages only |
| `n_diff_pfxNN` | Distinct values for first NN columns (cardinality) |

### §18.7 Empty tables consuming space

```sql
SELECT
  table_name,
  table_rows,
  ROUND((data_length+index_length)/1024/1024, 2) AS total_mb,
  create_time,
  update_time
FROM information_schema.tables
WHERE table_schema = 'point_stg_check'
  AND table_rows = 0
  AND (data_length + index_length) > 1024*1024
ORDER BY total_mb DESC;
```

### §18.8 Index-heavy tables

```sql
-- ratio > 1 = indexes larger than data (candidate for index pruning review)
SELECT
  table_name,
  ROUND(data_length/1024/1024, 1)  AS data_mb,
  ROUND(index_length/1024/1024, 1) AS idx_mb,
  ROUND(index_length / NULLIF(data_length,0), 2) AS idx_to_data_ratio
FROM information_schema.tables
WHERE table_schema = 'point_stg_check'
  AND data_length > 10*1024*1024
ORDER BY idx_to_data_ratio DESC
LIMIT 20;
```

### §18.9 Recently updated tables

```sql
SELECT
  table_name,
  ROUND((data_length+index_length)/1024/1024, 1) AS total_mb,
  table_rows,
  update_time,
  create_time
FROM information_schema.tables
WHERE table_schema = 'point_stg_check'
ORDER BY update_time DESC
LIMIT 30;
```

### §18.10 One-liners (from shell)

```bash
# Top 20 largest tables of point_stg_check (viewer_user)
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" -e "SELECT table_name, ROUND((data_length+index_length)/1024/1024,1) AS total_mb FROM information_schema.tables WHERE table_schema='point_stg_check' ORDER BY total_mb DESC LIMIT 20;" point_stg_check

# Total size of every database
SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/viewer_user --query SecretString --output text) && mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" -e "SELECT table_schema AS db, ROUND(SUM(data_length+index_length)/1024/1024/1024,2) AS gb FROM information_schema.tables WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys') GROUP BY table_schema ORDER BY gb DESC;"
```

### §18.11 Helper functions (pt-size-*)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Top N largest tables of a database
pt-size-top() {
  local db=${1:-point_stg_check}
  local n=${2:-30}
  local user=${3:-viewer_user}
  export AWS_REGION=ap-northeast-1
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/$user --query SecretString --output text) && \
  mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" \
        -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" \
        -e "SELECT table_name, table_rows, \
                   ROUND((data_length+index_length)/1024/1024,1) AS total_mb, \
                   ROUND(data_length/1024/1024,1) AS data_mb, \
                   ROUND(index_length/1024/1024,1) AS idx_mb \
            FROM information_schema.tables \
            WHERE table_schema='$db' \
            ORDER BY (data_length+index_length) DESC LIMIT $n;" "$db"
}

# Total size per database
pt-size-all() {
  local user=${1:-viewer_user}
  export AWS_REGION=ap-northeast-1
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/$user --query SecretString --output text) && \
  mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" \
        -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" \
        -e "SELECT table_schema AS db, COUNT(*) AS tables, \
                   ROUND(SUM(data_length+index_length)/1024/1024/1024,2) AS total_gb, \
                   ROUND(SUM(data_length)/1024/1024/1024,2) AS data_gb, \
                   ROUND(SUM(index_length)/1024/1024/1024,2) AS index_gb \
            FROM information_schema.tables \
            WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys') \
            GROUP BY table_schema ORDER BY total_gb DESC;"
}

# Total size of one database
pt-size-db() {
  local db=${1:-point_stg_check}
  local user=${2:-viewer_user}
  export AWS_REGION=ap-northeast-1
  SECRET=$(aws secretsmanager get-secret-value --secret-id point/aurora/$user --query SecretString --output text) && \
  mysql -h "$(echo $SECRET | jq -r .host)" -P "$(echo $SECRET | jq -r .port)" \
        -u "$(echo $SECRET | jq -r .username)" -p"$(echo $SECRET | jq -r .password)" \
        -e "SELECT '$db' AS db, COUNT(*) AS tables, \
                   ROUND(SUM(data_length+index_length)/1024/1024/1024,2) AS total_gb, \
                   ROUND(SUM(data_length)/1024/1024/1024,2) AS data_gb, \
                   ROUND(SUM(index_length)/1024/1024/1024,2) AS index_gb, \
                   SUM(table_rows) AS rows_estimate \
            FROM information_schema.tables \
            WHERE table_schema='$db';"
}
```

**Usage:**

```bash
pt-size-top                                    # Top 30 tables of point_stg_check
pt-size-top point_stg_check 50                 # Top 50 tables
pt-size-top point_stg_check 30 master_user     # Use master_user
pt-size-all                                    # Total size of every database
pt-size-db point_stg_check                     # Summary of a single database
```

---

## §19 CloudWatch Storage (Aurora cluster-level)

`VolumeBytesUsed` reflects actual storage allocated to the Aurora cluster (shared across writer + readers). Includes undo log, binlog cache, temp tablespace — always ≥ `SUM(data_length+index_length)` from `information_schema`.

> **Important:** Metric on the `point` cluster publishes roughly every **1 hour** (not every 5 min).
> Use a 24h window + `--period 3600` to avoid empty Datapoints.

| CloudWatch retention | Period |
|---------------------|--------|
| 1-min metrics | 15 days |
| 5-min metrics | 63 days |
| 1-hour metrics | 455 days |

> **macOS note:** Replace `date -u -d '24 hours ago'` with `date -u -v-24H` on macOS (BSD date).

### §19.1 Get current storage used

```bash
# Linux (GNU date)
aws cloudwatch get-metric-statistics \
  --region ap-northeast-1 \
  --namespace AWS/RDS \
  --metric-name VolumeBytesUsed \
  --dimensions Name=DBClusterIdentifier,Value=point \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time   $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 3600 \
  --statistics Average \
  --query 'sort_by(Datapoints,&Timestamp)[-1].[Timestamp,Average]' \
  --output text \
  | awk '{printf "point storage used: %.2f GB (at %s)\n", $2/1024/1024/1024, $1}'
```

### §19.2 Raw dump (all datapoints in 24h window)

```bash
aws cloudwatch get-metric-statistics \
  --region ap-northeast-1 \
  --namespace AWS/RDS \
  --metric-name VolumeBytesUsed \
  --dimensions Name=DBClusterIdentifier,Value=point \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time   $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 3600 \
  --statistics Average \
  --output json
```

### §19.3 Check metric exists / list dimensions

Use when query returns empty Datapoints — verifies metric + permissions.

```bash
aws cloudwatch list-metrics \
  --region ap-northeast-1 \
  --namespace AWS/RDS \
  --metric-name VolumeBytesUsed \
  --dimensions Name=DBClusterIdentifier,Value=point \
  --output table
```

### §19.4 List clusters and global clusters

```bash
aws rds describe-db-clusters \
  --region ap-northeast-1 \
  --query 'DBClusters[*].[DBClusterIdentifier,Engine,Status,StorageType]' \
  --output table

aws rds describe-global-clusters \
  --region ap-northeast-1 \
  --query 'GlobalClusters[*].[GlobalClusterIdentifier,GlobalClusterMembers[*].DBClusterArn]' \
  --output json
```

### §19.5 Helper function (pt-storage)

Handles empty Datapoints gracefully (AWS CLI returns literal `None`).

```bash
pt-storage() {
  local cluster=${1:-point}
  export AWS_REGION=ap-northeast-1
  local raw
  raw=$(aws cloudwatch get-metric-statistics \
    --region ap-northeast-1 \
    --namespace AWS/RDS \
    --metric-name VolumeBytesUsed \
    --dimensions Name=DBClusterIdentifier,Value=$cluster \
    --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
    --end-time   $(date -u +%Y-%m-%dT%H:%M:%SZ) \
    --period 3600 \
    --statistics Average \
    --query 'sort_by(Datapoints,&Timestamp)[-1].[Timestamp,Average]' \
    --output text)
  if [ -z "$raw" ] || echo "$raw" | grep -q "None"; then
    echo "NO DATA for cluster '$cluster' - check cluster name or IAM permissions"
    return 1
  fi
  echo "$raw" | awk -v c="$cluster" '{printf "%s cluster storage used: %.2f GB (at %s)\n", c, $2/1024/1024/1024, $1}'
}
```

**Usage:**

```bash
pt-storage               # cluster 'point' (default)
pt-storage my-cluster    # any DBClusterIdentifier
```

---

## §20 Important Notes (Size Statistics)

- `information_schema.tables` values (especially `table_rows`) are **approximate**; for exact counts run `SELECT COUNT(*)` on the specific table
- `ANALYZE TABLE` improves accuracy but is I/O heavy — skip for routine checks
- On Aurora: `data_free` is effectively 0 — do **NOT** use to measure fragmentation
- `VolumeBytesUsed` (CloudWatch) > `SUM(data_length+index_length)` is normal; 10–30% overhead is expected
- Use `viewer_user` for all queries on `information_schema.tables` (§18.1–§18.9); switch to `master_user` only for `mysql.innodb_index_stats` (§18.6)
- Compare measurements over time to detect growth trends before they impact performance or backup windows
- Heavy DDL (`ALTER TABLE`, `OPTIMIZE`) on large tables is risky — always check the target table size via §18.3 first
