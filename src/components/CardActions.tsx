"use client";

import { useState } from "react";

/** Print / save as PDF, and copy the card's link to send to the rep. */
export default function CardActions() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2 print:hidden">
      <button onClick={() => window.print()} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
        Print / save PDF
      </button>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
        {copied ? "Link copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
