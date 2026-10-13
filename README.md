# CAPTAIN — v1.0.0 Beta

本文件夹是可直接发布的静态网站。将整个文件夹内容放在 GitHub 仓库的发布分支根目录，在仓库 **Settings → Pages → Build and deployment** 中选择 **Deploy from a branch**、对应分支及 **/(root)**。`index.html`、`dist/`、`assets/`、`vendor/` 与 `.nojekyll` 必须保持当前相对位置。

网页使用浏览器本地存储保存部分操作状态；刷新或换设备后的状态取决于该浏览器的存储。建议使用最新版 Chrome 或 Edge，并保持网络连接以加载 Material Symbols 字体。

**公开发布提示：** GitHub Pages 是公开的静态托管。入口密码仅控制页面上的进入流程，不能阻止访问者直接下载或查看仓库中的模型、图片及其他文件。如果这些资源需要真正保密，应改用带服务器端认证与受控资源访问的托管方案。
