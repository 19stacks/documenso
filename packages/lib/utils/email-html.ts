/**
 * Checks whether a rendered email HTML body is valid for sending.
 *
 * Guards against sending emails with an empty or truncated body, which
 * happens when the async render stream is read before it has fully
 * completed. A broken body causes recipients to receive an email with a
 * subject but a blank/empty body.
 */
export const isEmailHtmlValid = (html: string): boolean => {
  const trimmed = html.trim();

  return trimmed.length > 0 && trimmed.endsWith('</html>');
};
