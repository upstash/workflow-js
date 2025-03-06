'use client';

import React, { useEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-twilight.css';
import cx from '@/app/utils/cx';

export default function CodeBlock({
  children,
  className,
  ...props
}: React.ComponentProps<'pre'>) {
  const ref = React.useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    Prism.highlightElement(ref.current);
  }, [children]);

  return (
    <pre
      className={cx('!p-4 !rounded-xl !border-0 !text-sm !m-0', className)}
      {...props}
    >
      <code ref={ref}>{children}</code>
    </pre>
  );
}
