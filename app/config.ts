// Debugging Environment Variable
const envUrl = process.env.NEXT_PUBLIC_API_URL;

// If Env var is missing or empty string, fallback to localhost
const API_URL = (envUrl && envUrl.trim() !== '') ? envUrl : 'http://localhost:8000';

console.log(`[Config] Loaded API_URL: ${API_URL} (Origin Env: ${envUrl})`);

export default API_URL;
