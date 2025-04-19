import React, { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import JSZip from 'jszip';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import wpFilters from './wp-filters.json'
import { Helmet } from 'react-helmet';

import './App.css';

// Maximum file size (150MB)
const MAX_FILE_SIZE = 150 * 1024 * 1024;

// Allowed file extensions in the zip
const ALLOWED_EXTENSIONS = ['.php', '.inc', '.txt', '.md'];

// Potentially dangerous file extensions
const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.htm', '.phtml'];

function App() {

  const [filters, setFilters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const knownHooks = new Set(wpFilters.map(entry => entry.Hook).filter(Boolean));
  const [visibleCount, setVisibleCount] = useState(10); // Start by showing 10


  // Debounce the search term
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const copyToClipboard = (text, index) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1000);
    });
  };

  const sanitizeCode = (code) => {
    return code
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<\?php\s*eval\s*\(/gi, '<?php /* eval removed */ (')
      .replace(/<\?php\s*base64_decode\s*\(/gi, '<?php /* base64_decode removed */ (')
      .replace(/<\?php\s*system\s*\(/gi, '<?php /* system removed */ (')
      .replace(/<\?php\s*exec\s*\(/gi, '<?php /* exec removed */ (')
      .replace(/<\?php\s*shell_exec\s*\(/gi, '<?php /* shell_exec removed */ (');
  };

  const validateZipContents = (zip) => {
    const files = Object.keys(zip.files);

    const dangerousFiles = files.filter(file =>
      DANGEROUS_EXTENSIONS.some(ext => file.toLowerCase().endsWith(ext))
    );

    if (dangerousFiles.length > 0) {
      throw new Error(`Potentially dangerous files found: ${dangerousFiles.join(', ')}`);
    }

    const phpFiles = files.filter(file =>
      file.toLowerCase().endsWith('.php')
    );

    if (phpFiles.length === 0) {
      throw new Error('No PHP files found in the zip. This does not appear to be a WordPress plugin.');
    }
  };

  const findContainingFunction = (content, applyFiltersIndex) => {
    // Find the start of the function
    let functionStart = content.lastIndexOf('function', applyFiltersIndex);
    if (functionStart === -1) return null;

    // Find the function name
    const functionNameMatch = content.substring(functionStart).match(/function\s+(\w+)\s*\(/);
    if (!functionNameMatch) return null;
    const functionName = functionNameMatch[1];

    // Find the end of the function
    let bracketCount = 0;
    let functionEnd = functionStart;
    let inFunction = false;

    while (functionEnd < content.length) {
      if (content[functionEnd] === '{') {
        bracketCount++;
        inFunction = true;
      } else if (content[functionEnd] === '}') {
        bracketCount--;
        if (inFunction && bracketCount === 0) {
          break;
        }
      }
      functionEnd++;
    }

    if (functionEnd >= content.length) return null;

    return {
      name: functionName,
      content: content.substring(functionStart, functionEnd + 1)
    };
  };

  const onDrop = useCallback(async (acceptedFiles) => {
    setLoading(true);
    setError(null);
    setFilters([]);
    setSearchTerm('');

    try {
      const file = acceptedFiles[0];

      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File is too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
      }

      const zip = new JSZip();
      const content = await zip.loadAsync(file);

      validateZipContents(content);

      const filterResults = [];
      let processedFiles = 0;

      for (const [relativePath, zipEntry] of Object.entries(content.files)) {
        if (relativePath.endsWith('.php') ||
          relativePath.endsWith('.inc') ||
          relativePath.includes('.php') ||
          !relativePath.includes('.')) {
          try {
            const fileContent = await zipEntry.async('text');
            const sanitizedContent = sanitizeCode(fileContent);
            processedFiles++;

            // Find apply_filters calls
            const applyFiltersRegex = /apply_filters\s*\(\s*['"]([^'"]+)['"]\s*,[^)]*\)/g;
            let match;

            while ((match = applyFiltersRegex.exec(sanitizedContent)) !== null) {
              const filterName = match[1];
              const applyFiltersCall = match[0];

              // Find the containing function
              const containingFunction = findContainingFunction(sanitizedContent, match.index);

              if (containingFunction) {
                // Get the line number
                const lines = sanitizedContent.substring(0, match.index).split('\n');
                const lineNumber = lines.length;

                if (!knownHooks.has(filterName)) {
                  filterResults.push({
                    filterName,
                    functionName: containingFunction.name,
                    applyFiltersCall,
                    functionContext: containingFunction.content,
                    file: relativePath,
                    lineNumber
                  });
                }

              }
            }
          } catch (err) {
            console.warn(`Error processing file ${relativePath}:`, err);
          }
        }
      }

      console.log(`Processed ${processedFiles} files, found ${filterResults.length} filters`);
      setFilters(filterResults);
    } catch (err) {
      setError('Error processing the zip file: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/zip': ['.zip']
    },
    multiple: false,
    maxSize: MAX_FILE_SIZE
  });

  // Pre-process the filters for faster searching
  const processedFilters = useMemo(() => {
    return filters.map(filter => ({
      ...filter,
      searchableText: `${filter.filterName} ${filter.functionName} ${filter.file}`.toLowerCase()
    }));
  }, [filters]);

  // Optimized search function
  const searchFilters = useCallback((term) => {
    if (!term) return processedFilters;

    const searchTerm = term.toLowerCase();
    return processedFilters.filter(filter =>
      filter.searchableText.includes(searchTerm)
    );
  }, [processedFilters]);

  // Memoized search results
  const filteredFilters = useMemo(() => {
    return searchFilters(debouncedSearchTerm);
  }, [searchFilters, debouncedSearchTerm]);

  return (

    <div id="app" className="App">

      <Helmet>
        <title>WordPress Filter Finder</title>
        <meta name="description" content="Upload a WordPress plugin or theme and detect custom apply_filters() calls. Easily find hooks not in core WordPress." />

        {/* Favicons */}
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-small.png" />
        <link rel="icon" type="image/png" sizes="96x96" href="/favicon-large.png" />
        <link rel="apple-touch-icon" href="/favicon-large.png" />

        {/* Open Graph Meta Tags */}
        <meta property="og:title" content="WordPress Filter Finder" />
        <meta property="og:description" content="Upload a WordPress plugin and detect custom apply_filters() calls. Easily find hooks not in core WordPress." />
        <meta property="og:image" content="/favicon-large.png" />
        <meta property="og:type" content="website" />
      </Helmet>


      <header className="App-header">
        <h1>WordPress<span className="highlight"> Filter Finder</span></h1>
        <p>Drag and drop a WordPress plugin/theme zip file to extract custom <code>apply_filters()</code> calls. Known Wordpress filters are excluded.</p>
      </header>

      <div className="dropzone-container">
        <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
          <input {...getInputProps()} />
          {isDragActive ? (
            <p>Drop the zip file here...</p>
          ) : (
            <p>Drag 'n' drop a WordPress plugin zip file here, or click to select</p>
          )}
          <p className="file-size-limit">Maximum file size: {MAX_FILE_SIZE / 1024 / 1024}MB</p>
        </div>
      </div>

      {loading && <div className="loading">Processing...</div>}

      {error && <div className="error">{error}</div>}

      {filters.length > 0 && (
        <div className="results">
          <div className="results-found">
            {filters.length} total filters found!
          </div>
          <div className="search-container">
            <div className="search-input-wrapper">
              <input
                type="text"
                placeholder="Search filters..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              {searchTerm && (
                <button
                  className="clear-button"
                  onClick={() => setSearchTerm('')}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
            <div className="filter-count">
              Showing {filteredFilters.length} of {filters.length} filters
            </div>
            <div className="download-json">
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(filteredFilters, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'custom-wp-filters.json';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="download-button"
              >
                Download as JSON
              </button>
            </div>
          </div>

          {filteredFilters.length === 0 && (
            <div className="no-results">
              No filters match your search :(
            </div>
          )}

          {filteredFilters.slice(0, visibleCount).map((filter, index) => (
            <div key={index} className="filter-card">
              <h3>Filter: {filter.filterName}</h3>
              <p><strong>Function:</strong> {filter.functionName}()</p>
              <p><strong>File:</strong> /{filter.file}</p>
              <p><strong>Line num:</strong> {filter.lineNumber}</p>
              <div className="code-block">
                <h4>Function Context:</h4>
                <div className="code-container">
                  <button
                    className="copy-button"
                    onClick={() => copyToClipboard(filter.functionContext, `func-${index}`)}
                    title="Copy to clipboard"
                  >
                    <svg className="copy-icon" viewBox="0 0 24 24">
                      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                    </svg>
                    {copiedIndex === `func-${index}` && <span className="copy-tooltip">Copied!</span>}
                  </button>
                  <SyntaxHighlighter language="php" style={tomorrow}>
                    {filter.functionContext}
                  </SyntaxHighlighter>
                </div>
              </div>
              <div className="usage">
                <h4>Filter Applied:</h4>
                <div className="code-container">
                  <button
                    className="copy-button"
                    onClick={() => copyToClipboard(filter.applyFiltersCall, `apply-${index}`)}
                    title="Copy to clipboard"
                  >
                    <svg className="copy-icon" viewBox="0 0 24 24">
                      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                    </svg>
                    {copiedIndex === `apply-${index}` && <span className="copy-tooltip">Copied!</span>}
                  </button>
                  <SyntaxHighlighter language="php" style={tomorrow}>
                    {filter.applyFiltersCall}
                  </SyntaxHighlighter>
                </div>
              </div>
            </div>
          ))}
        </div>

      )}
      {visibleCount < filteredFilters.length && (
        <div className="show-more-container">
          <button className="show-more-button" onClick={() => setVisibleCount(prev => prev + 10)}>
            Show more
          </button>
          <a href="#app" className="back-to-top">
            <img src="/chevron-up.svg" alt="arrow-up" />
          </a>
        </div>
      )}
    </div>

  );
}

export default App;
