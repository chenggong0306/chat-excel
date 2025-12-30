# ChatExcel 部署文档

## 1. 部署前需要修改的文件

| 文件 | 修改内容 | 本地开发 | Linux 部署 |
|------|---------|---------|-----------|
| `src/services/api.ts` | 第1行 `API_BASE` | `"http://localhost:8000"` | `""` |
| `backend/main.py` | 最后一行 uvicorn | `host="0.0.0.0", port=8000` | `host="0.0.0.0", port=9011` |

## 2. Linux 部署步骤

### 2.1 上传代码

把整个 `chat-excel` 文件夹复制到 `/home/chenggong/chat-excel`

### 2.2 前端构建

```bash
cd /home/chenggong/chat-excel

# 先修改 API 地址为空（让 Nginx 代理）
# src/services/api.ts 第1行改成: const API_BASE = "";

npm install
npm run build
```

### 2.3 设置权限

```bash
chmod 755 /home/chenggong
chmod 755 /home/chenggong/chat-excel
chmod -R 755 /home/chenggong/chat-excel/dist
```

### 2.4 配置 Nginx

```bash
cat > /etc/nginx/sites-available/chatexcel.conf << 'EOF'
server {
    listen 9012;
    server_name _;

    root /home/chenggong/chat-excel/dist;
    index index.html;

    client_max_body_size 50M;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:9011/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
EOF

# 启用配置
ln -sf /etc/nginx/sites-available/chatexcel.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 测试并重启
nginx -t
service nginx restart
```

### 2.5 启动后端

```bash
cd /home/chenggong/chat-excel/backend

# 安装依赖（首次）
uv sync
#启动环境
source .venv/bin/activate
# 后台启动
nohup uv run main.py > backend.log 2>&1 &
```

### 2.6 验证部署

```bash
# 检查端口
netstat -tlnp | grep -E "9011|9012"

# 测试后端
curl http://localhost:9011/health

# 测试前端
curl http://localhost:9012
```

## 3. 访问地址

| 服务 | 地址 |
|------|------|
| 前端页面 | `http://192.168.132.104:9012` |
| 后端 API | `http://192.168.132.104:9011` |

## 4. 常用运维命令

```bash
# 查看后端日志
tail -f /home/chenggong/chat-excel/backend/backend.log

# 查看 Nginx 错误日志
tail -f /var/log/nginx/error.log

# 重启后端
pkill -f "main.py"
cd /home/chenggong/chat-excel/backend
nohup uv run main.py > backend.log 2>&1 &

# 重启 Nginx
service nginx restart

# 更新代码后重新部署
cd /home/chenggong/chat-excel
npm run build
chmod -R 755 dist
service nginx restart
```

