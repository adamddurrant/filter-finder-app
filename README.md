# WordPress Filter Finder

**WordPress Filter Finder** is a React-based web app that helps developers identify custom `apply_filters()` calls in WordPress plugin or theme ZIP files. Core WordPress filters are excluded, making it easy to spot custom hooks created by the plugin/theme author.

![Screenshot](/filter-finder.jpg)

---

## 🚀 Features

- 🧠 Detects custom `apply_filters()` calls from uploaded WordPress plugin/theme ZIP files
- 🔍 Search and filter through detected custom hooks
- 🧼 Sanitizes potentially harmful PHP code (e.g. `eval`, `exec`, etc.)
- 📄 Displays function context and file information for each filter
- 📋 One-click copy of function and filter code snippets
- 💾 Download all results as a JSON file
- 🛡️ Rejects ZIPs with potentially dangerous files
- 🎯 Ignores core WordPress filters using a bundled `wp-filters.json`

---

## 📦 Usage

   ```bash
   git clone https://github.com/yourusername/wp-filter-finder.git
   cd wp-filter-finder
   npm i
   npm start
