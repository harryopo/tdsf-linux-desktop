#!/bin/bash
# ============================================================================
# TDSF-Linux 演示环境故障注入脚本
# ============================================================================
#
# 用途：为 TDSF-Linux 桌面助手的现场演示/比赛注入可控故障，
#       让 AI 运维助手有真实的故障场景可诊断。
#
# 用法：
#   ssh user@server 'bash -s' < scripts/demo-setup.sh [scenario]
#   或直接在服务器上执行：
#   bash scripts/demo-setup.sh [scenario]
#
# scenario 参数：
#   502       - 场景 1：慢查询导致 Web 502
#   disk-full - 场景 2：磁盘满导致服务异常
#   oom       - 场景 3：内存耗尽触发 OOM Killer
#   all       - 依次注入所有故障（间隔 5 秒）
#   cleanup   - 清理所有注入的故障，恢复环境
#   status    - 查看当前故障注入状态
#
# 安全声明：
#   - 本脚本仅用于演示/教学虚拟机环境
#   - 所有操作均可通过 cleanup 模式完全回滚
#   - 不会修改系统关键配置（如 /etc/fstab、grub 等）
#   - 建议在独立的演示 VM 上运行，勿用于生产环境
#
# 依赖：
#   - CentOS 7/8 或 Ubuntu 20.04+（演示 VM 默认环境）
#   - root 或 sudo 权限
#   - nginx、mysql/mariadb（场景 1 需要）
#
# 作者：TDSF-Linux 团队
# 版本：v1.0
# ============================================================================

set -euo pipefail

# ========================== 全局配置 ==========================

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 故障注入标记目录（所有注入文件集中管理，便于 cleanup）
FAULT_DIR="/tmp/.tdsf-demo-faults"

# 场景 1 配置：慢查询 → 502
MYSQL_SLEEP_SECONDS=30
NGINX_TIMEOUT=5
DEMO_DB="tdsf_demo"
DEMO_PROC="slow_query_proc"
NGINX_CONF="/etc/nginx/conf.d/tdsf-demo-502.conf"

# 场景 2 配置：磁盘满
DISK_FILL_TARGET="/var/log"
DISK_FILL_PERCENT=95
FILL_FILE="${FAULT_DIR}/disk-fill.img"

# 场景 3 配置：OOM
OOM_PROC_COUNT=3
OOM_PROC_MEM_MB=512
OOM_PID_FILE="${FAULT_DIR}/oom-pids.txt"

# ========================== 工具函数 ==========================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# 检查是否以 root 运行
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "本脚本需要 root 权限运行（演示 VM 环境）"
        log_error "请使用: sudo bash $0 $*"
        exit 1
    fi
}

# 初始化故障标记目录
init_fault_dir() {
    mkdir -p "${FAULT_DIR}"
}

# 检测包管理器（yum 或 apt）
detect_pkg_mgr() {
    if command -v yum &>/dev/null; then
        echo "yum"
    elif command -v apt-get &>/dev/null; then
        echo "apt"
    else
        log_error "未找到 yum 或 apt 包管理器"
        exit 1
    fi
}

# 确保依赖已安装
ensure_package() {
    local pkg="$1"
    local pkg_mgr
    pkg_mgr=$(detect_pkg_mgr)

    if [[ "${pkg_mgr}" == "yum" ]]; then
        rpm -q "${pkg}" &>/dev/null || {
            log_step "安装依赖: ${pkg}"
            yum install -y -q "${pkg}" 2>/dev/null
        }
    else
        dpkg -l "${pkg}" &>/dev/null 2>&1 || {
            log_step "安装依赖: ${pkg}"
            apt-get install -y -qq "${pkg}" 2>/dev/null
        }
    fi
}

# ========================== 场景 1：慢查询 → Web 502 ==========================
#
# 原理：
#   1. 创建 MySQL 存储过程，内部 SLEEP 30 秒模拟慢查询
#   2. 配置 Nginx 反向代理到后端，设置 proxy_read_timeout = 5 秒
#   3. 后端 PHP/Python 调用该存储过程 → 超过 Nginx 超时 → 返回 502
#
# 演示效果：
#   用户访问 http://server/demo-slow → 等待 5 秒后看到 502 Bad Gateway
#   TDSF AI 助手可通过 nginx error.log + MySQL slow log 诊断根因
# ============================================================================

setup_502() {
    log_step "========== 场景 1：慢查询 → Web 502 =========="
    init_fault_dir

    # --- 步骤 1：确保 MySQL/MariaDB 运行 ---
    log_step "检查 MySQL/MariaDB 服务..."
    local mysql_svc=""
    if systemctl is-active mysqld &>/dev/null; then
        mysql_svc="mysqld"
    elif systemctl is-active mariadb &>/dev/null; then
        mysql_svc="mariadb"
    else
        log_warn "MySQL/MariaDB 未运行，尝试启动..."
        systemctl start mysqld 2>/dev/null || systemctl start mariadb 2>/dev/null || {
            log_error "无法启动 MySQL/MariaDB，跳过场景 1"
            return 1
        }
        mysql_svc="mysqld"
        systemctl is-active mariadb &>/dev/null && mysql_svc="mariadb"
    fi
    log_info "MySQL 服务: ${mysql_svc} (运行中)"

    # --- 步骤 2：创建演示数据库和慢查询存储过程 ---
    log_step "创建慢查询存储过程 (SLEEP ${MYSQL_SLEEP_SECONDS}s)..."
    mysql -u root <<EOF
-- 创建演示数据库（如不存在）
CREATE DATABASE IF NOT EXISTS ${DEMO_DB};
USE ${DEMO_DB};

-- 删除旧存储过程（幂等）
DROP PROCEDURE IF EXISTS ${DEMO_PROC};

-- 创建模拟慢查询的存储过程
-- 模拟场景：复杂报表查询未加索引，全表扫描耗时 30 秒
DELIMITER //
CREATE PROCEDURE ${DEMO_PROC}()
BEGIN
    -- 模拟慢查询：SLEEP 代表无索引的全表扫描
    DO SLEEP(${MYSQL_SLEEP_SECONDS});
    SELECT 'slow query completed' AS result;
END //
DELIMITER ;

-- 创建一张演示表（让 slow log 更真实）
CREATE TABLE IF NOT EXISTS demo_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(10,2),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- 故意不加索引，模拟慢查询场景
    status VARCHAR(20) DEFAULT 'pending'
);

-- 插入少量测试数据
INSERT INTO demo_orders (user_id, amount, status)
SELECT FLOOR(RAND()*1000), RAND()*100, 'pending'
FROM information_schema.tables LIMIT 50;
EOF
    log_info "存储过程 ${DEMO_DB}.${DEMO_PROC} 创建成功"

    # --- 步骤 3：创建后端 CGI 脚本（调用慢查询） ---
    log_step "创建后端脚本..."
    mkdir -p /var/www/tdsf-demo
    cat > /var/www/tdsf-demo/slow-query.cgi <<'CGIEOF'
#!/bin/bash
# 模拟后端应用调用慢查询存储过程
echo "Content-Type: text/plain"
echo ""
echo "正在执行报表查询..."
mysql -u root tdsf_demo -e "CALL slow_query_proc();" 2>&1
echo "查询完成"
CGIEOF
    chmod +x /var/www/tdsf-demo/slow-query.cgi

    # --- 步骤 4：配置 Nginx 反向代理（短超时） ---
    log_step "配置 Nginx 反向代理 (timeout=${NGINX_TIMEOUT}s)..."
    ensure_package nginx

    cat > "${NGINX_CONF}" <<EOF
# TDSF 演示：慢查询 → 502 故障注入
# 由 scripts/demo-setup.sh 自动生成，cleanup 时删除
server {
    listen 8880;
    server_name _;

    # 正常页面（用于对比）
    location / {
        return 200 "TDSF Demo Server - OK\n";
        add_header Content-Type text/plain;
    }

    # 慢查询接口 → 触发 502
    location /demo-slow {
        # 关键：设置极短的超时时间（5 秒）
        # 后端存储过程 SLEEP 30 秒 → 必然超时 → 502
        proxy_pass http://127.0.0.1:8881;
        proxy_read_timeout ${NGINX_TIMEOUT}s;
        proxy_connect_timeout 3s;
        proxy_send_timeout ${NGINX_TIMEOUT}s;
    }
}

# 模拟后端服务（Python 简易 HTTP）
server {
    listen 8881;
    server_name _;

    location / {
        # 使用 Python 调用 MySQL 慢查询
        content_by_lua_block {
            os.execute("mysql -u root tdsf_demo -e 'CALL slow_query_proc();'")
            ngx.say("query done")
        }
    }
}
EOF

    # 如果没有 lua 模块，用更简单的 fcgi 方式
    # 回退方案：直接用 Python 后端
    cat > /var/www/tdsf-demo/slow-backend.py <<'PYEOF'
#!/usr/bin/env python3
"""模拟后端服务：调用 MySQL 慢查询存储过程"""
import http.server
import subprocess
import socketserver

PORT = 8881

class SlowHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b"Executing slow query...\n")
        self.wfile.flush()
        try:
            # 调用慢查询存储过程（SLEEP 30s）
            result = subprocess.run(
                ['mysql', '-u', 'root', 'tdsf_demo', '-e', 'CALL slow_query_proc();'],
                capture_output=True, text=True, timeout=60
            )
            self.wfile.write(result.stdout.encode())
        except subprocess.TimeoutExpired:
            self.wfile.write(b"Query timed out!\n")

    def log_message(self, format, *args):
        pass  # 静默日志

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), SlowHandler) as httpd:
        print(f"Slow backend listening on port {PORT}")
        httpd.serve_forever()
PYEOF
    chmod +x /var/www/tdsf-demo/slow-backend.py

    # 简化 Nginx 配置（不依赖 lua 模块）
    cat > "${NGINX_CONF}" <<EOF
# TDSF 演示：慢查询 → 502 故障注入
# 由 scripts/demo-setup.sh 自动生成，cleanup 时删除
server {
    listen 8880;
    server_name _;

    # 正常页面（用于对比）
    location / {
        return 200 "TDSF Demo Server - OK\n";
        add_header Content-Type text/plain;
    }

    # 慢查询接口 → 触发 502
    location /demo-slow {
        # 关键：设置极短的超时时间（${NGINX_TIMEOUT} 秒）
        # 后端存储过程 SLEEP ${MYSQL_SLEEP_SECONDS} 秒 → 必然超时 → 502 Bad Gateway
        proxy_pass http://127.0.0.1:8881;
        proxy_read_timeout ${NGINX_TIMEOUT}s;
        proxy_connect_timeout 3s;
        proxy_send_timeout ${NGINX_TIMEOUT}s;
    }
}
EOF

    # --- 步骤 5：启动后端服务 + 重载 Nginx ---
    log_step "启动模拟后端服务 (port 8881)..."
    # 先杀掉旧的后端进程（幂等）
    pkill -f "slow-backend.py" 2>/dev/null || true
    nohup python3 /var/www/tdsf-demo/slow-backend.py > "${FAULT_DIR}/slow-backend.log" 2>&1 &
    echo $! > "${FAULT_DIR}/slow-backend.pid"

    log_step "重载 Nginx 配置..."
    nginx -t 2>/dev/null && systemctl reload nginx || systemctl restart nginx

    # --- 步骤 6：生成流量触发 502（后台） ---
    log_step "生成演示流量（后台持续请求 /demo-slow）..."
    cat > "${FAULT_DIR}/traffic-gen.sh" <<'TRAFFICEOF'
#!/bin/bash
# 持续生成流量，确保 nginx error.log 中有 502 记录
while true; do
    curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8880/demo-slow 2>/dev/null
    sleep 2
done
TRAFFICEOF
    chmod +x "${FAULT_DIR}/traffic-gen.sh"
    nohup bash "${FAULT_DIR}/traffic-gen.sh" > /dev/null 2>&1 &
    echo $! > "${FAULT_DIR}/traffic-gen.pid"

    # 记录注入状态
    echo "502" >> "${FAULT_DIR}/active-scenarios"

    log_info "场景 1 注入完成！"
    log_info "  正常页面: curl http://server:8880/"
    log_info "  触发 502: curl http://server:8880/demo-slow"
    log_info "  诊断线索: /var/log/nginx/error.log + MySQL slow log"
}

# ========================== 场景 2：磁盘满 → 服务异常 ==========================
#
# 原理：
#   1. 使用 fallocate/dd 创建大文件填满 /var/log 分区到 95%+
#   2. 依赖 /var/log 的服务（rsyslog、应用日志）将写入失败
#   3. 模拟真实场景：日志未轮转导致磁盘满
#
# 演示效果：
#   - rsyslog 报错 "No space left on device"
#   - 应用无法写入日志 → 服务异常
#   - TDSF AI 助手可通过 df -h + du 诊断根因
# ============================================================================

setup_disk_full() {
    log_step "========== 场景 2：磁盘满 → 服务异常 =========="
    init_fault_dir

    # --- 步骤 1：检查目标分区当前使用率 ---
    log_step "检查 ${DISK_FILL_TARGET} 分区使用情况..."
    local current_usage
    current_usage=$(df "${DISK_FILL_TARGET}" | awk 'NR==2 {gsub(/%/,""); print $5}')
    log_info "当前使用率: ${current_usage}%"

    if [[ ${current_usage} -ge ${DISK_FILL_PERCENT} ]]; then
        log_warn "分区已达到 ${current_usage}%，无需额外填充"
        echo "disk-full" >> "${FAULT_DIR}/active-scenarios"
        return 0
    fi

    # --- 步骤 2：计算需要填充的空间 ---
    # 获取分区总大小和已用大小（单位 KB）
    local total_kb used_kb avail_kb target_used_kb fill_kb
    total_kb=$(df "${DISK_FILL_TARGET}" | awk 'NR==2 {print $2}')
    used_kb=$(df "${DISK_FILL_TARGET}" | awk 'NR==2 {print $3}')
    avail_kb=$(df "${DISK_FILL_TARGET}" | awk 'NR==2 {print $4}')

    # 目标：填充到 95% 使用率
    target_used_kb=$((total_kb * DISK_FILL_PERCENT / 100))
    fill_kb=$((target_used_kb - used_kb))

    # 安全检查：至少保留 200MB 可用空间（避免完全锁死系统）
    local min_free_kb=204800  # 200MB
    local max_fill_kb=$((avail_kb - min_free_kb))
    if [[ ${fill_kb} -gt ${max_fill_kb} ]]; then
        fill_kb=${max_fill_kb}
        log_warn "安全限制：保留 200MB 可用空间，实际填充到约 $(( (used_kb + fill_kb) * 100 / total_kb ))%"
    fi

    if [[ ${fill_kb} -le 0 ]]; then
        log_warn "无需填充（已接近目标使用率）"
        echo "disk-full" >> "${FAULT_DIR}/active-scenarios"
        return 0
    fi

    local fill_mb=$((fill_kb / 1024))
    log_step "将创建 ${fill_mb}MB 填充文件..."

    # --- 步骤 3：创建填充文件 ---
    # 使用 fallocate（快速）或 dd（兼容）
    if command -v fallocate &>/dev/null; then
        fallocate -l "${fill_mb}M" "${FILL_FILE}"
    else
        dd if=/dev/zero of="${FILL_FILE}" bs=1M count="${fill_mb}" 2>/dev/null
    fi

    # 记录填充文件信息（cleanup 用）
    echo "${FILL_FILE}" > "${FAULT_DIR}/disk-fill-path"

    # --- 步骤 4：验证效果 ---
    local new_usage
    new_usage=$(df "${DISK_FILL_TARGET}" | awk 'NR==2 {gsub(/%/,""); print $5}')
    log_info "填充后使用率: ${new_usage}%"

    # --- 步骤 5：生成一些写入失败的日志（让故障更明显） ---
    log_step "触发日志写入失败..."
    for i in $(seq 1 5); do
        logger -t tdsf-demo "磁盘满故障注入测试 - 第 ${i} 次写入尝试" 2>/dev/null || true
    done

    # 尝试写入一个应用日志（模拟服务异常）
    echo "$(date) ERROR: Failed to write log - No space left on device" \
        >> /var/log/tdsf-demo-app.log 2>/dev/null || true

    echo "disk-full" >> "${FAULT_DIR}/active-scenarios"

    log_info "场景 2 注入完成！"
    log_info "  查看磁盘: df -h ${DISK_FILL_TARGET}"
    log_info "  查找大文件: du -sh ${DISK_FILL_TARGET}/*"
    log_info "  诊断线索: df -h 显示 ${new_usage}% + 填充文件 ${FILL_FILE}"
}

# ========================== 场景 3：OOM Killer ==========================
#
# 原理：
#   1. 启动多个内存占用进程，逐步耗尽系统可用内存
#   2. 当内存不足时，Linux OOM Killer 选择进程杀死
#   3. dmesg / /var/log/messages 中留下 OOM 日志
#
# 演示效果：
#   - 系统响应变慢
#   - dmesg 出现 "Out of memory: Kill process" 日志
#   - 某些服务被 OOM Killer 杀死
#   - TDSF AI 助手可通过 dmesg + free -h 诊断根因
#
# 安全设计：
#   - 使用 cgroup 限制内存 Hog 进程（避免杀死 sshd 等关键服务）
#   - 如果 cgroup 不可用，设置 oom_score_adj 保护关键进程
# ============================================================================

setup_oom() {
    log_step "========== 场景 3：OOM Killer =========="
    init_fault_dir

    # --- 步骤 1：检查系统可用内存 ---
    log_step "检查系统内存..."
    local total_mem_mb avail_mem_mb
    total_mem_mb=$(free -m | awk 'NR==2 {print $2}')
    avail_mem_mb=$(free -m | awk 'NR==2 {print $7}')
    log_info "总内存: ${total_mem_mb}MB, 可用: ${avail_mem_mb}MB"

    if [[ ${avail_mem_mb} -lt 100 ]]; then
        log_warn "可用内存已不足 100MB，无需额外注入"
        echo "oom" >> "${FAULT_DIR}/active-scenarios"
        return 0
    fi

    # --- 步骤 2：保护关键进程不被 OOM Kill ---
    log_step "保护关键进程 (sshd, systemd)..."
    # 将 sshd 的 oom_score_adj 设为 -1000（永不被 OOM Kill）
    local sshd_pid
    sshd_pid=$(pgrep -x sshd | head -1) || true
    if [[ -n "${sshd_pid}" ]]; then
        echo -1000 > "/proc/${sshd_pid}/oom_score_adj" 2>/dev/null || true
    fi

    # --- 步骤 3：创建内存 Hog 脚本 ---
    log_step "创建内存占用进程 (${OOM_PROC_COUNT} 个, 每个 ${OOM_PROC_MEM_MB}MB)..."

    cat > "${FAULT_DIR}/mem-hog.py" <<'HOGEOF'
#!/usr/bin/env python3
"""
内存占用进程 - TDSF 演示用
逐步分配内存，模拟内存泄漏场景。
进程名伪装为 'java-report-worker'（更贴近真实场景）。
"""
import sys
import time
import os

# 伪装进程名（让 ps 输出更真实）
try:
    import ctypes
    libc = ctypes.CDLL('libc.so.6')
    libc.prctl(15, b'java-report-wkr', 0, 0, 0)
except Exception:
    pass

target_mb = int(sys.argv[1]) if len(sys.argv) > 1 else 512
chunk_size = 10 * 1024 * 1024  # 每次分配 10MB

data = []
allocated = 0

print(f"[mem-hog] PID={os.getpid()}, 目标: {target_mb}MB")

try:
    while allocated < target_mb:
        # 分配 10MB 并写入数据（确保物理内存被占用）
        chunk = bytearray(chunk_size)
        for i in range(0, chunk_size, 4096):
            chunk[i] = 0xFF  # 触发页面分配
        data.append(chunk)
        allocated += 10
        time.sleep(0.5)  # 缓慢分配，让监控工具能观察到渐变
except (MemoryError, OSError):
    print(f"[mem-hog] 内存分配失败，已占用 {allocated}MB")

# 保持进程存活（持续占用内存）
print(f"[mem-hog] 已占用 {allocated}MB，保持运行...")
while True:
    time.sleep(60)
HOGEOF
    chmod +x "${FAULT_DIR}/mem-hog.py"

    # --- 步骤 4：启动内存 Hog 进程 ---
    > "${OOM_PID_FILE}"  # 清空 PID 文件

    for i in $(seq 1 ${OOM_PROC_COUNT}); do
        log_step "启动内存占用进程 #${i} (${OOM_PROC_MEM_MB}MB)..."
        nohup python3 "${FAULT_DIR}/mem-hog.py" "${OOM_PROC_MEM_MB}" \
            > "${FAULT_DIR}/mem-hog-${i}.log" 2>&1 &
        echo $! >> "${OOM_PID_FILE}"
        sleep 1
    done

    # --- 步骤 5：等待 OOM 触发（可选） ---
    log_step "内存占用进程已启动，等待系统内存紧张..."
    log_info "提示：OOM Killer 触发需要一定时间，取决于系统总内存"
    log_info "可通过 'watch -n1 free -h' 观察内存变化"
    log_info "通过 'dmesg | grep -i oom' 查看 OOM Killer 日志"

    echo "oom" >> "${FAULT_DIR}/active-scenarios"

    log_info "场景 3 注入完成！"
    log_info "  查看内存: free -h"
    log_info "  查看进程: ps aux --sort=-%mem | head"
    log_info "  OOM 日志: dmesg | grep -i 'out of memory'"
    log_info "  进程 PID: cat ${OOM_PID_FILE}"
}

# ========================== 清理所有故障 ==========================

cleanup_all() {
    log_step "========== 清理所有注入的故障 =========="
    init_fault_dir

    # --- 清理场景 1：502 ---
    log_step "清理场景 1 (502)..."
    # 停止流量生成器
    if [[ -f "${FAULT_DIR}/traffic-gen.pid" ]]; then
        kill "$(cat "${FAULT_DIR}/traffic-gen.pid")" 2>/dev/null || true
        rm -f "${FAULT_DIR}/traffic-gen.pid"
    fi
    pkill -f "traffic-gen.sh" 2>/dev/null || true

    # 停止后端服务
    if [[ -f "${FAULT_DIR}/slow-backend.pid" ]]; then
        kill "$(cat "${FAULT_DIR}/slow-backend.pid")" 2>/dev/null || true
        rm -f "${FAULT_DIR}/slow-backend.pid"
    fi
    pkill -f "slow-backend.py" 2>/dev/null || true

    # 删除 Nginx 配置并重载
    if [[ -f "${NGINX_CONF}" ]]; then
        rm -f "${NGINX_CONF}"
        nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
        log_info "Nginx 配置已恢复"
    fi

    # 删除 MySQL 存储过程和演示数据库
    if command -v mysql &>/dev/null; then
        mysql -u root -e "DROP DATABASE IF EXISTS ${DEMO_DB};" 2>/dev/null || true
        log_info "MySQL 演示数据库已删除"
    fi

    # 删除后端脚本
    rm -rf /var/www/tdsf-demo

    # --- 清理场景 2：磁盘满 ---
    log_step "清理场景 2 (disk-full)..."
    if [[ -f "${FILL_FILE}" ]]; then
        rm -f "${FILL_FILE}"
        log_info "填充文件已删除: ${FILL_FILE}"
    fi
    if [[ -f "${FAULT_DIR}/disk-fill-path" ]]; then
        local fill_path
        fill_path=$(cat "${FAULT_DIR}/disk-fill-path")
        rm -f "${fill_path}" 2>/dev/null || true
        rm -f "${FAULT_DIR}/disk-fill-path"
    fi
    # 删除演示日志
    rm -f /var/log/tdsf-demo-app.log 2>/dev/null || true
    local disk_usage
    disk_usage=$(df "${DISK_FILL_TARGET}" | awk 'NR==2 {gsub(/%/,""); print $5}')
    log_info "磁盘使用率恢复为: ${disk_usage}%"

    # --- 清理场景 3：OOM ---
    log_step "清理场景 3 (oom)..."
    # 杀死所有内存 Hog 进程
    if [[ -f "${OOM_PID_FILE}" ]]; then
        while read -r pid; do
            kill "${pid}" 2>/dev/null || true
        done < "${OOM_PID_FILE}"
        rm -f "${OOM_PID_FILE}"
    fi
    pkill -f "mem-hog.py" 2>/dev/null || true
    # 也尝试按伪装名杀
    pkill -f "java-report-wkr" 2>/dev/null || true
    log_info "内存占用进程已终止"

    # 恢复 sshd 的 oom_score_adj
    local sshd_pid
    sshd_pid=$(pgrep -x sshd | head -1) || true
    if [[ -n "${sshd_pid}" ]]; then
        echo 0 > "/proc/${sshd_pid}/oom_score_adj" 2>/dev/null || true
    fi

    # --- 清理故障标记目录 ---
    log_step "清理故障标记目录..."
    rm -rf "${FAULT_DIR}"

    log_info "=========================================="
    log_info "所有故障已清理，环境已恢复正常！"
    log_info "=========================================="
}

# ========================== 状态查看 ==========================

show_status() {
    echo ""
    log_step "========== 故障注入状态 =========="
    echo ""

    if [[ ! -d "${FAULT_DIR}" ]]; then
        log_info "无活跃故障注入（标记目录不存在）"
        return 0
    fi

    # 显示活跃场景
    if [[ -f "${FAULT_DIR}/active-scenarios" ]]; then
        log_info "已注入的场景:"
        while read -r scenario; do
            case "${scenario}" in
                502)       echo "  - [场景1] 慢查询 → 502 (端口 8880)" ;;
                disk-full) echo "  - [场景2] 磁盘满 (${DISK_FILL_TARGET})" ;;
                oom)       echo "  - [场景3] OOM 内存耗尽" ;;
            esac
        done < "${FAULT_DIR}/active-scenarios"
    else
        log_info "无活跃场景记录"
    fi

    echo ""

    # 场景 1 状态
    if pgrep -f "slow-backend.py" &>/dev/null; then
        log_info "[场景1] 后端服务: 运行中"
    fi
    if [[ -f "${NGINX_CONF}" ]]; then
        log_info "[场景1] Nginx 配置: 已注入"
    fi

    # 场景 2 状态
    if [[ -f "${FILL_FILE}" ]]; then
        local fill_size
        fill_size=$(du -sh "${FILL_FILE}" 2>/dev/null | awk '{print $1}')
        log_info "[场景2] 填充文件: ${FILL_FILE} (${fill_size})"
    fi
    local disk_usage
    disk_usage=$(df "${DISK_FILL_TARGET}" | awk 'NR==2 {gsub(/%/,""); print $5}')
    log_info "[场景2] ${DISK_FILL_TARGET} 使用率: ${disk_usage}%"

    # 场景 3 状态
    local mem_hogs
    mem_hogs=$(pgrep -f "mem-hog.py" | wc -l)
    if [[ ${mem_hogs} -gt 0 ]]; then
        log_info "[场景3] 内存占用进程: ${mem_hogs} 个运行中"
    fi
    free -h | head -2

    echo ""
}

# ========================== 主入口 ==========================

usage() {
    echo "用法: $0 <scenario>"
    echo ""
    echo "可用场景:"
    echo "  502       慢查询 → Web 502 (Nginx 超时)"
    echo "  disk-full 磁盘满 → 服务写入失败"
    echo "  oom       内存耗尽 → OOM Killer"
    echo "  all       依次注入所有故障"
    echo "  cleanup   清理所有故障，恢复环境"
    echo "  status    查看当前注入状态"
    echo ""
    echo "示例:"
    echo "  sudo bash $0 502        # 注入 502 故障"
    echo "  sudo bash $0 all        # 注入所有故障"
    echo "  sudo bash $0 cleanup    # 清理所有故障"
    echo "  ssh user@server 'bash -s' < $0 disk-full"
}

main() {
    local scenario="${1:-}"

    if [[ -z "${scenario}" ]]; then
        usage
        exit 1
    fi

    # status 不需要 root
    if [[ "${scenario}" != "status" ]]; then
        check_root
    fi

    case "${scenario}" in
        502)
            setup_502
            ;;
        disk-full)
            setup_disk_full
            ;;
        oom)
            setup_oom
            ;;
        all)
            log_info "依次注入所有故障场景（间隔 5 秒）..."
            echo ""
            setup_502
            echo ""
            sleep 5
            setup_disk_full
            echo ""
            sleep 5
            setup_oom
            echo ""
            log_info "=========================================="
            log_info "所有故障场景注入完成！"
            log_info "使用 '$0 status' 查看状态"
            log_info "使用 '$0 cleanup' 清理所有故障"
            log_info "=========================================="
            ;;
        cleanup)
            cleanup_all
            ;;
        status)
            show_status
            ;;
        *)
            log_error "未知场景: ${scenario}"
            echo ""
            usage
            exit 1
            ;;
    esac
}

main "$@"
