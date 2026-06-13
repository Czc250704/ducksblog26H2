const express = require('express');
const serverless = require('serverless-http');
const { Octokit } = require('@octokit/rest');
const cors = require('cors');

const express = require('express');
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 从环境变量读取 GitHub 配置（在 Vercel 中设置）
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const BRANCH = process.env.BRANCH || 'main';

const PORT = process.env.PORT || 3000;  // 从环境变量获取端口，默认3000
// 辅助函数：获取文件 SHA
async function getFileSha(path) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      ref: BRANCH,
    });
    return data.sha;
  } catch (err) {
    return null;
  }
}

// 读取 JSON 文件内容
app.get('/api/data/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const path = `data/${filename}.json`;
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      ref: BRANCH,
    });
    const content = Buffer.from(data.content, 'base64').toString();
    res.json(JSON.parse(content));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 保存 JSON 文件
app.post('/api/data/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const content = JSON.stringify(req.body, null, 2);
    const path = `data/${filename}.json`;
    const sha = await getFileSha(path);
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      message: `Update ${filename}.json via API`,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch: BRANCH,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 上传文件到 uploads/ 目录（base64 格式）
app.post('/api/upload', async (req, res) => {
  try {
    const { filename, base64Data } = req.body;
    const path = `uploads/${filename}`;
    const sha = await getFileSha(path);
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path,
      message: `Upload ${filename}`,
      content: base64Data,
      sha,
      branch: BRANCH,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取文件下载 URL（用于预览，需验证分类密码等逻辑由前端处理）
app.get('/api/file/*', async (req, res) => {
  const filePath = req.params[0];
  const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${filePath}`;
  res.json({ url: rawUrl });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// ... 所有路由、中间件等代码 ...

// 在文件最后添加（不要重复定义）
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`API running on http://0.0.0.0:${PORT}`);
});

module.exports.handler = serverless(app);