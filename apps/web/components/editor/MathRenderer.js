import { useRef, useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';
import katex from 'katex';

// Render math expressions found in HTML content
function renderMathInElement(element) {
  // Find all span[data-math] and div[data-math-block] elements and render with KaTeX
  const mathEls = element.querySelectorAll('span[data-math], div[data-math-block]');
  mathEls.forEach(el => {
    const latex = el.getAttribute('data-latex') || el.getAttribute('latex') || el.textContent;
    const isDisplay = el.hasAttribute('data-math-block') || el.getAttribute('display') === 'true';
    if (latex) {
      try {
        katex.render(latex, el, { throwOnError: false, displayMode: isDisplay });
      } catch {
        el.textContent = latex;
      }
    }
  });

  // Also handle inline LaTeX delimiters in text nodes (for backward compat / plain text content)
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (/\$\$.+?\$\$|\$[^$]+?\$/s.test(node.textContent)) {
      textNodes.push(node);
    }
  }

  textNodes.forEach(textNode => {
    const text = textNode.textContent;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;

    // Match $$...$$ first, then $...$
    const regex = /\$\$(.+?)\$\$|\$([^$]+?)\$/gs;
    let match;
    while ((match = regex.exec(text)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
      }

      const latex = match[1] || match[2];
      const isDisplay = !!match[1];
      const span = document.createElement(isDisplay ? 'div' : 'span');
      if (isDisplay) span.className = 'my-2 text-center';
      try {
        katex.render(latex, span, { throwOnError: false, displayMode: isDisplay });
      } catch {
        span.textContent = latex;
      }
      frag.appendChild(span);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    if (lastIndex > 0) {
      textNode.parentNode.replaceChild(frag, textNode);
    }
  });
}

// Sanitize HTML with DOMPurify, allowing math-related attributes
function sanitize(html) {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['span', 'div'],
    ADD_ATTR: ['data-math', 'data-math-block', 'data-latex', 'latex', 'display', 'class', 'style'],
    ALLOW_ARIA_ATTR: true,
  });
}

// Check if content looks like HTML or plain text
function isHTML(str) {
  return /<[a-z][\s\S]*>/i.test(str);
}

// Strip HTML tags and math for plain text preview
function toPlainText(html) {
  if (!html) return '';
  // Replace math nodes with their LaTeX
  let text = html.replace(/<span[^>]*data-math[^>]*(?:latex="([^"]*)")?[^>]*>.*?<\/span>/gi, (_, latex) => latex || '');
  text = text.replace(/<div[^>]*data-math-block[^>]*(?:latex="([^"]*)")?[^>]*>.*?<\/div>/gi, (_, latex) => latex || '');
  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return text.trim();
}

/**
 * Renders HTML content with KaTeX math support.
 *
 * @param {string} content - HTML or plain text content
 * @param {boolean} plainText - If true, renders as truncated plain text (for previews/notifications)
 * @param {string} className - Additional CSS classes
 */
export default function MathRenderer({ content, plainText = false, className = '' }) {
  const containerRef = useRef(null);

  const sanitizedHTML = useMemo(() => {
    if (!content) return '';
    if (plainText) return '';
    if (!isHTML(content)) {
      // Plain text content — wrap in pre-line paragraph, but still render math delimiters
      return `<div style="white-space: pre-line">${DOMPurify.sanitize(content)}</div>`;
    }
    return sanitize(content);
  }, [content, plainText]);

  useEffect(() => {
    if (containerRef.current && !plainText) {
      renderMathInElement(containerRef.current);
    }
  }, [sanitizedHTML, plainText]);

  if (!content) return null;

  if (plainText) {
    const text = toPlainText(content);
    return <span className={className}>{text}</span>;
  }

  return (
    <div
      ref={containerRef}
      className={`prose prose-sm dark:prose-invert max-w-none break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizedHTML }}
    />
  );
}

// Export utility for use in notifications etc
export { toPlainText };
