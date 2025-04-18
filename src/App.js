import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import JSZip from 'jszip';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import './App.css';

function App() {
  const [filters, setFilters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(null);

  const copyToClipboard = (text, index) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1000);
    });
  };

  const extractParams = (paramsString) => {
    // Split by commas that are not inside brackets or quotes
    const params = paramsString.split(/(?![^(]*\)),/).map(param => {
      // Remove type hints, default values, and array syntax
      return param
        .trim()
        .replace(/^\w+\s+\$/, '$') // Remove type hints
        .replace(/\s*=\s*.*$/, '') // Remove default values
        .replace(/\[\s*\]/g, '') // Remove empty array brackets
        .replace(/array\s*\([^)]*\)/g, '$array') // Replace array() with $array
        .replace(/\[[^\]]*\]/g, '$array'); // Replace [] with $array
    }).filter(Boolean);
    
    return params;
  };

  const cleanFilterCall = (filterCall) => {
    // Remove backslash and trim
    return filterCall.replace(/^\\/, '').trim();
  };

  const cleanFunctionContext = (context) => {
    // Remove all backslashes before function calls
    return context.replace(/\\/g, '');
  };

  const onDrop = useCallback(async (acceptedFiles) => {
    setLoading(true);
    setError(null);
    setFilters([]);
    setSearchTerm('');

    try {
      const file = acceptedFiles[0];
      const zip = new JSZip();
      const content = await zip.loadAsync(file);
      
      const filterResults = [];
      let processedFiles = 0;
      
      // Process each file in the zip
      for (const [relativePath, zipEntry] of Object.entries(content.files)) {
        // Check if file is PHP or might contain PHP code
        if (relativePath.endsWith('.php') || 
            relativePath.endsWith('.inc') || 
            relativePath.includes('.php') || 
            !relativePath.includes('.')) {
          try {
            const fileContent = await zipEntry.async('text');
            processedFiles++;
            
            // Find add_filter calls - very simple pattern
            const filterRegex = /add_filter/g;
            let match;
            
            while ((match = filterRegex.exec(fileContent)) !== null) {
              // Get the full line containing the add_filter call
              const lineStart = fileContent.lastIndexOf('\n', match.index) + 1;
              const lineEnd = fileContent.indexOf('\n', match.index);
              const fullLine = fileContent.substring(lineStart, lineEnd).trim();
              
              // Try to extract filter name and function name
              const filterNameMatch = fullLine.match(/['"]([^'"]+)['"]/);
              const functionNameMatch = fullLine.match(/,\s*['"]([^'"]+)['"]/);
              
              if (filterNameMatch && functionNameMatch) {
                const filterName = filterNameMatch[1];
                const functionName = functionNameMatch[1];
                
                // Find the function definition with a more flexible pattern
                const functionRegex = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{[^}]*\\}`, 's');
                const functionMatch = functionRegex.exec(fileContent);
                
                if (functionMatch) {
                  const functionDef = functionMatch[0];
                  const paramsMatch = functionDef.match(/function\s+\w+\s*\(([^)]*)\)/);
                  const bodyMatch = functionDef.match(/\{([^}]*)\}/s);
                  
                  if (paramsMatch && bodyMatch) {
                    const params = paramsMatch[1].trim();
                    const body = bodyMatch[1].trim();
                    
                    // Get the line number
                    const lines = fileContent.substring(0, match.index).split('\n');
                    const lineNumber = lines.length;
                    
                    // Extract parameter names for usage example
                    const paramNames = extractParams(params);
                    
                    filterResults.push({
                      filterName,
                      functionName,
                      params,
                      paramNames,
                      context: cleanFunctionContext(body),
                      addFilterCode: cleanFilterCall(fullLine),
                      file: relativePath,
                      lineNumber
                    });
                  }
                } else {
                  // If we can't find the function definition, still include the filter
                  const lines = fileContent.substring(0, match.index).split('\n');
                  const lineNumber = lines.length;
                  
                  // Try to get the number of parameters from the add_filter call
                  const acceptedArgsMatch = fullLine.match(/,\s*(\d+)\s*\)/);
                  const numParams = acceptedArgsMatch ? parseInt(acceptedArgsMatch[1]) : 1;
                  const defaultParams = Array(numParams).fill(0).map((_, i) => `$param${i + 1}`);
                  
                  filterResults.push({
                    filterName,
                    functionName,
                    params: 'unknown',
                    paramNames: defaultParams,
                    context: 'Function definition not found',
                    addFilterCode: cleanFilterCall(fullLine),
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
    multiple: false
  });

  const filteredFilters = filters.filter(filter => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      filter.filterName.toLowerCase().includes(searchLower) ||
      filter.functionName.toLowerCase().includes(searchLower) ||
      filter.file.toLowerCase().includes(searchLower) ||
      filter.addFilterCode.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="App">
      <header className="App-header">
        <h1>WordPress Filter Finder</h1>
        <p>Drag and drop a WordPress plugin zip file to fetch all filter hooks</p>
      </header>

      <div className="dropzone-container">
        <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
          <input {...getInputProps()} />
          {isDragActive ? (
            <p>Drop the zip file here...</p>
          ) : (
            <p>Drag 'n' drop a WordPress plugin zip file here, or click to select</p>
          )}
        </div>
      </div>

      {loading && <div className="loading">Processing...</div>}
      
      {error && <div className="error">{error}</div>}

      {filters.length > 0 && (
        <div className="results">
          <div className="results-found">
            {filters.length} filters found!
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
          </div>
          {filteredFilters.map((filter, index) => (
            <div key={index} className="filter-card">
              <h3>Filter: {filter.filterName}</h3>
              <p>Function: {filter.functionName}</p>
              <p>File: {filter.file} (Line {filter.lineNumber})</p>
              <div className="code-block">
                <h4>Add Filter Boilerplate:</h4>
                <div className="code-container">
                  <button 
                    className="copy-button"
                    onClick={() => copyToClipboard(filter.addFilterCode, `add-${index}`)}
                    title="Copy to clipboard"
                  >
                    <svg className="copy-icon" viewBox="0 0 24 24">
                      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                    </svg>
                    {copiedIndex === `add-${index}` && <span className="copy-tooltip">Copied!</span>}
                  </button>
                  <SyntaxHighlighter language="php" style={tomorrow}>
                    {filter.addFilterCode}
                  </SyntaxHighlighter>
                </div>
              </div>
              {filter.context !== 'Function definition not found' && (
                <>
                  <div className="code-block">
                    <h4>Filter Definition:</h4>
                    <div className="code-container">
                      <button 
                        className="copy-button"
                        onClick={() => copyToClipboard(`function ${filter.functionName}(${filter.params}) {\n${filter.context}\n}`, `def-${index}`)}
                        title="Copy to clipboard"
                      >
                        <svg className="copy-icon" viewBox="0 0 24 24">
                          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                        </svg>
                        {copiedIndex === `def-${index}` && <span className="copy-tooltip">Copied!</span>}
                      </button>
                      <SyntaxHighlighter language="php" style={tomorrow}>
                        {`function ${filter.functionName}(${filter.params}) {
${filter.context}
}`}
                      </SyntaxHighlighter>
                    </div>
                  </div>
                  <div className="usage">
                    <h4>Usage Example:</h4>
                    <div className="code-container">
                      <button 
                        className="copy-button"
                        onClick={() => copyToClipboard(
                          filter.paramNames.length > 0 
                            ? `apply_filters('${filter.filterName}', ${filter.paramNames.join(', ')})`
                            : `apply_filters('${filter.filterName}')`,
                          `usage-${index}`
                        )}
                        title="Copy to clipboard"
                      >
                        <svg className="copy-icon" viewBox="0 0 24 24">
                          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                        </svg>
                        {copiedIndex === `usage-${index}` && <span className="copy-tooltip">Copied!</span>}
                      </button>
                      <SyntaxHighlighter language="php" style={tomorrow}>
                        {filter.paramNames.length > 0 
                          ? `apply_filters('${filter.filterName}', ${filter.paramNames.join(', ')})`
                          : `apply_filters('${filter.filterName}')`}
                      </SyntaxHighlighter>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
