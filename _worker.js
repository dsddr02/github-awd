export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // === 处理非根路径 (GitHub Raw 代理) ===
        if (url.pathname !== '/') {
            // 1. 获取并验证 GitHub Token (安全方式)
            const githubToken = env.GH_TOKEN; // 从 Secret 获取
            if (!githubToken) {
                console.error("错误：GH_TOKEN 未配置为 Secret。");
                return new Response('服务器配置错误：缺少授权凭证', { status: 500 });
            }

            // 2. 构建目标 GitHub Raw URL (简化逻辑)
            let githubRawUrl = 'https://raw.githubusercontent.com';
            const repoPath = [env.GH_NAME, env.GH_REPO, env.GH_BRANCH]
                               .filter(Boolean) // 过滤掉未设置的部分
                               .join('/');

            if (!repoPath) {
                 console.error("错误：GH_NAME, GH_REPO, 或 GH_BRANCH 未完整配置。");
                 return new Response('服务器配置错误：缺少仓库信息', { status: 500 });
            }

            // 确保路径以 / 开头且不包含开头的 / (如果 url.pathname 本身带 /)
            const filePath = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
            githubRawUrl = `${githubRawUrl}/${repoPath}/${filePath}`;

            console.log(`代理目标: ${githubRawUrl}`); // 调试日志

            // 3. 构建请求头
            const headers = new Headers({
                'Authorization': `token ${githubToken}`,
                'User-Agent': 'Cloudflare-Worker-GitHub-Proxy' // 推荐添加 User-Agent
            });

            try {
                // 4. 发起请求到 GitHub
                const response = await fetch(githubRawUrl, { headers });

                // 5. 处理 GitHub 的响应
                if (response.ok) {
                    // 直接将 GitHub 的响应流式传输回去
                    // 注意：直接复制 headers 可能包含不适合暴露的头，按需复制
                    const responseHeaders = new Headers();
                    // 复制必要的 Headers，例如 Content-Type, Content-Length 等
                    if (response.headers.has('Content-Type')) {
                        responseHeaders.set('Content-Type', response.headers.get('Content-Type'));
                    }
                    if (response.headers.has('Content-Length')) {
                        responseHeaders.set('Content-Length', response.headers.get('Content-Length'));
                    }
                    // 可以添加自定义 Header
                    responseHeaders.set('X-Proxied-By', 'MyCloudflareWorker');

                    return new Response(response.body, {
                        status: response.status,
                        headers: responseHeaders // 使用筛选后的头
                    });
                } else {
                    // GitHub 返回错误
                    const errorText = env.ERROR || `无法从 GitHub 获取文件。状态码: ${response.status}. 检查路径或TOKEN是否正确。`;
                    console.error(`GitHub 请求失败: ${response.status} ${response.statusText} for ${githubRawUrl}`);
                    // 返回更详细的错误给客户端
                    return new Response(`${errorText}\nGitHub Status: ${response.status} ${response.statusText}`, {
                         status: response.status // 保持 GitHub 的错误状态码
                    });
                }
            } catch (error) {
                 console.error(`Workspace to GitHub failed: ${error}`);
                 return new Response('代理请求到 GitHub 时发生内部错误', { status: 500 });
            }

        // === 处理根路径 ===
        } else {
            const envKey = env.URL302 ? 'URL302' : (env.URL ? 'URL' : null);
            if (envKey) {
                try {
                    const urls = parseUrls(env[envKey]); // 使用优化后的解析函数
                    if (urls.length > 0) {
                        const targetUrl = urls[Math.floor(Math.random() * urls.length)];
                        console.log(`根路径操作: ${envKey} -> ${targetUrl}`);
                        if (envKey === 'URL302') {
                            return Response.redirect(targetUrl, 302);
                        } else {
                            // 代理根路径请求
                            return fetch(new Request(targetUrl, request));
                        }
                    } else {
                         console.warn(`环境变量 ${envKey} 配置不正确或为空。`);
                    }
                } catch (e) {
                     console.error(`解析环境变量 ${envKey} 出错: ${e}`);
                }
            }

            // 默认返回 Nginx 伪装页
            console.log("根路径操作: 返回 Nginx 伪装页");
            return new Response(nginxHtml(), {
                headers: {
                    'Content-Type': 'text/html; charset=UTF-8',
                },
            });
        }
    }
};

// Nginx 伪装页 HTML (保持不变，移出 fetch)
function nginxHtml() {
    return `
    <!DOCTYPE html>
    <html>
    <head>
    <title>Welcome to nginx!</title>
    <style>
        body {
            width: 35em;
            margin: 0 auto;
            font-family: Tahoma, Verdana, Arial, sans-serif;
        }
    </style>
    </head>
    <body>
    <h1>Welcome to nginx!</h1>
    <p>If you see this page, the nginx web server is successfully installed and
    working. Further configuration is required.</p>

    <p>For online documentation and support please refer to
    <a href="http://nginx.org/">nginx.org</a>.<br/>
    Commercial support is available at
    <a href="http://nginx.com/">nginx.com</a>.</p>

    <p><em>Thank you for using nginx.</em></p>
    </body>
    </html>
    `;
}

// 优化后的 URL 解析函数 (替代 ADD)
function parseUrls(envUrls) {
    if (!envUrls || typeof envUrls !== 'string') {
        return [];
    }
    // 替换多种分隔符为空格，然后按空格分割，过滤空字符串
    const urls = envUrls
        .replace(/[,\s"'\r\n]+/g, ' ') // 替换所有分隔符和空白为一个空格
        .trim()                     // 去除首尾空格
        .split(' ')                 // 按空格分割
        .filter(url => url.length > 0 && url.startsWith('http')); // 过滤空项和非 URL 项
    return urls;
}
