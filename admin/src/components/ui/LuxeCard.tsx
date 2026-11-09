import React from 'react';

interface LuxeCardProps {
  children: React.ReactNode;
  className?: string;
  glass?: boolean;
}

export const LuxeCard: React.FC<LuxeCardProps> = ({ children, className = '', glass = false }) => {
  const baseClass = glass ? 'luxe-glass-card' : 'luxe-card';
  return (
    <div className={`${baseClass} p-6 transition-all duration-200 ${className}`}>
      {children}
    </div>
  );
};
