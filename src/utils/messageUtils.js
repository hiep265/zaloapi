/**
 * Detect if a message contains links (especially image links)
 * @param {string} message - The message to check
 * @returns {{hasLinks: boolean, links: string[], textWithoutLinks: string}}
 */
export function detectLinks(message) {
  if (!message || typeof message !== 'string') {
    return { hasLinks: false, links: [], textWithoutLinks: message || '' };
  }

  // Regular expression to match URLs
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const links = message.match(urlRegex) || [];
  const hasLinks = links.length > 0;
  
  // Remove links from the message to get clean text
  const textWithoutLinks = message.replace(urlRegex, '').trim();
  
  return { hasLinks, links, textWithoutLinks };
}

export default { detectLinks };
