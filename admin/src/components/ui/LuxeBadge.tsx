import React from 'react';

interface LuxeBadgeProps {
  children: React.ReactNode;
  variant?: 'sage' | 'terracota' | 'gold' | 'neutral';
  className?: string;
}

export const LuxeBadge: React.FC<LuxeBadgeProps> = ({
  children,
  variant = 'gold',
  className = ''
}) => {
  const variantClasses = {
    sage: 'luxe-badge-sage',
    terracota: 'luxe-badge-terracota',
    gold: 'luxe-badge-gold',
    neutral: 'bg-stone-100 text-stone-700 border border-stone-200'
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
};
