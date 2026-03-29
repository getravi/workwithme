# Web Tools Extension

A Pi extension that provides web fetching and searching capabilities.

## Tools

### `web-fetch`

Fetch and extract content from a URL.

**Parameters:**

| Name      | Type   | Required | Description                                                 |
| --------- | ------ | -------- | ----------------------------------------------------------- |
| `url`     | string | Yes      | URL to fetch                                                |
| `format`  | string | No       | Output format: `markdown` (default), `text`, `html`, `json` |
| `headers` | object | No       | Custom request headers                                      |

### `web-search`

Search the web using Exa AI.

**Parameters:**

| Name         | Type   | Required | Description                             |
| ------------ | ------ | -------- | --------------------------------------- |
| `query`      | string | Yes      | Search query                            |
| `numResults` | number | No       | Number of results (default: 8, max: 20) |

## Environment Variables

| Name          | Required | Description                                   |
| ------------- | -------- | --------------------------------------------- |
| `EXA_API_KEY` | No       | Optional API key for authenticated Exa access |

## Dependencies

- `jsdom` - HTML parsing
- `turndown` - HTML to Markdown conversion
