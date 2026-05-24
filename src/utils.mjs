export function isCaptchaPage(html = '', title = '') {
  const text = html.toLowerCase();
  const lowerTitle = title.toLowerCase();

  // Google
  if (text.includes('id="captcha-form"') || text.includes('id="recaptcha"') || text.includes('action="sorry"')) {
    return true;
  }
  if (lowerTitle.includes('robot') || lowerTitle.includes('captcha')) {
    return true;
  }

  // DDG
  if (text.includes('too many requests') || text.includes('automated access')) {
    return true;
  }

  // General/Cloudflare
  if (lowerTitle.includes('just a moment') || lowerTitle.includes('attention required')) {
    return true;
  }

  return false;
}

export function extractJobLinksFromPage(html) {
  // A basic regex fallback extractor for string HTML, if evaluate isn't possible
  // Extracts <a href="...">...</a> and tries to guess the title
  const results = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let match;
  
  const seen = new Set();

  while ((match = linkRegex.exec(html)) !== null) {
    let url = match[1].trim();
    let content = match[2];

    // clean tags from content
    let title = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    
    if (!title || url.startsWith('javascript:') || url.startsWith('#')) continue;
    
    // Ignore internal google/ddg links if this is a search page
    if (url.includes('google.com') || url.includes('duckduckgo.com')) continue;
    
    if (seen.has(url)) continue;
    seen.add(url);

    results.push({
      url,
      title,
      description: ''
    });
  }

  return results;
}
