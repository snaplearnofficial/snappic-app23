const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');
html = html.replace(/<script>[\s\S]*?<\/script>/, '<script src="/socket.io/socket.io.js"></script>\n<script src="app.js"></script>');
fs.writeFileSync('public/index.html', html);
