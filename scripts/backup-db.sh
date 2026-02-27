#!/bin/bash
# ============================================================
# 数据库备份脚本
# 功能：
#   1. 自动备份数据库到本地
#   2. 可选：上传备份到腾讯云COS
#   3. 可选：设置定时任务自动备份
#
# 使用方法：
#   ./scripts/backup-db.sh                    # 本地备份
#   ./scripts/backup-db.sh --cos             # 本地备份 + 上传COS
#   ./scripts/backup-db.sh --install-cron    # 安装定时任务（每天凌晨3点自动备份）
# ============================================================

set -e

# 配置
BACKUP_DIR="./data/backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_FILE="./data/app.db"
DB_NAME="app.db"
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE}.backup.db"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== 数据库备份脚本 ===${NC}"

# 创建备份目录
mkdir -p "${BACKUP_DIR}"

# 检查数据库文件是否存在
if [ ! -f "${DB_FILE}" ]; then
    echo -e "${RED}错误：数据库文件不存在: ${DB_FILE}${NC}"
    exit 1
fi

# 执行备份
echo "正在备份数据库..."
cp "${DB_FILE}" "${BACKUP_FILE}"
if [ -f "${DB_FILE}-shm" ]; then
    cp "${DB_FILE}-shm" "${BACKUP_FILE}-shm"
fi
if [ -f "${DB_FILE}-wal" ]; then
    cp "${DB_FILE}-wal" "${BACKUP_FILE}-wal"
fi

echo -e "${GREEN}✓ 本地备份成功: ${BACKUP_FILE}${NC}"

# 清理旧备份（保留最近30天）
find "${BACKUP_DIR}" -name "*.backup.db" -mtime +30 -delete 2>/dev/null || true
echo "已清理30天前的旧备份"

# 如果指定了 --cos 参数，上传到腾讯云COS
if [ "$1" = "--cos" ] || [ "$1" = "-c" ]; then
    echo -e "${YELLOW}开始上传到腾讯云COS...${NC}"
    
    # 检查coscmd是否安装
    if ! command -v coscmd &> /dev/null; then
        echo -e "${RED}错误：coscmd未安装，请运行: pip install coscmd${NC}"
        exit 1
    fi
    
    # 检查COS配置
    if [ -z "$COS_BUCKET" ] || [ -z "$COS_SECRET_ID" ]; then
        echo -e "${RED}错误：请设置COS环境变量: COS_BUCKET, COS_SECRET_ID, COS_SECRET_KEY, COS_REGION${NC}"
        exit 1
    fi
    
    # 配置coscmd
    coscmd config -a $COS_SECRET_ID -s $COS_SECRET_KEY -r $COS_REGION -b $COS_BUCKET
    
    # 上传备份
    BACKUP_KEY="backups/${DB_NAME}_${DATE}.backup.db"
    coscmd upload "${BACKUP_FILE}" "${BACKUP_KEY}"
    
    echo -e "${GREEN}✓ 已上传到COS: ${BACKUP_KEY}${NC}"
    
    # 清理COS上的旧备份（保留最近30天）
    coscmd listprefix "backups/" | grep -oP "backups/${DB_NAME}_[0-9]{8}_[0-9]{6}\.backup\.db" | while read -r key; do
        dateStr=$(echo "$key" | grep -oP "[0-9]{8}_[0-9]{6}")
        if [ -n "$dateStr" ]; then
            fileDate=$(date -d "${dateStr:0:8}" +%s 2>/dev/null || echo "0")
            nowDate=$(date +%s)
            days=$(( (nowDate - fileDate) / 86400 ))
            if [ "$days" -gt 30 ]; then
                coscmd delete "$key"
                echo "已删除COS上的旧备份: $key"
            fi
        fi
    done
fi

echo -e "${GREEN}=== 备份完成 ===${NC}"
echo "备份文件位置: ${BACKUP_FILE}"

# 安装定时任务
if [ "$1" = "--install-cron" ] || [ "$1" = "-i" ]; then
    echo -e "${YELLOW}安装定时备份任务...${NC}"
    
    # 创建定时任务脚本（不包含COS上传）
    CRON_SCRIPT="$(dirname "$0")/auto-backup.sh"
    cat > "${CRON_SCRIPT}" << 'EOF'
#!/bin/bash
cd /root/NBgarbagebpfilter
./scripts/backup-db.sh
EOF
    chmod +x "${CRON_SCRIPT}"
    
    # 添加定时任务（每天凌晨3点）
    (crontab -l 2>/dev/null | grep -v "backup-db.sh"; echo "0 3 * * * /root/NBgarbagebpfilter/scripts/backup-db.sh") | crontab -
    
    echo -e "${GREEN}✓ 已安装定时任务：每天凌晨3点自动备份${NC}"
    echo "查看定时任务: crontab -l"
fi
