const textContentTypes = [
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-www-form-urlencoded",
  "application/xhtml+xml",
  "application/ld+json",
  "application/rss+xml",
  "application/atom+xml",
];

const isText = (contentTypeHeader: string | null) => {
  if (!contentTypeHeader) {
    return false;
  }
  if (textContentTypes.some((type) => contentTypeHeader.includes(type))) {
    return true;
  }
  if (contentTypeHeader.startsWith("text/")) {
    return true;
  }
  return false;
};

export const parseResponseBody = async (out: string, contentTypeHeader: string | null) => {
  if (isText(contentTypeHeader)) {
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) {
      bytes[i] = out.charCodeAt(i);
    }

    const processedResult = new TextDecoder().decode(bytes);
    const newBody = JSON.parse(processedResult).body;

    try {
      return JSON.parse(newBody);
    } catch {
      return newBody;
    }
  } else {
    return out;
  }
};
