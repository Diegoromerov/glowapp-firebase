import React from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-card text-card-foreground p-8 rounded-2xl border border-border shadow-xl">
        {children}
      </div>
    </div>
  );
}

