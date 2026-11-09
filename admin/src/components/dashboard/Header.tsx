'use client';

import Link from 'next/link';
import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ThemeSelector } from '@/components/ui/theme-selector';
import { Bell, Search, Menu, X, ChevronDown, LogOut, User as UserIcon } from 'lucide-react';

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user, logout } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="header" role="banner">
      <div className="header-left">
        <button 
          className="mobile-menu-btn"
          onClick={onMenuClick}
          aria-label="Abrir menú"
        >
          <Menu size={20} />
        </button>
        
        <div className="relative max-w-md w-full hidden md:block">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
            <Search size={18} />
          </span>
          <input
            type="text"
            placeholder="Buscar servicios, precios, auditoría..."
            className="form-input pl-10 pr-4"
            aria-label="Buscar"
          />
        </div>
      </div>

      <div className="header-right">
        {/* Theme Selector */}
        <ThemeSelector />
        
        {/* Notifications */}
        <div className="dropdown" ref={notificationsRef}>
          <button
            className="btn-icon relative"
            onClick={() => { setNotificationsOpen(!notificationsOpen); setUserMenuOpen(false); }}
            aria-label="Notificaciones"
            aria-expanded={notificationsOpen}
          >
            <Bell size={20} />
            <span className="dot" aria-hidden="true" />
          </button>
          {notificationsOpen && (
            <div className="dropdown-menu" role="menu">
              <div className="p-3 border-b border-border">
                <h3 className="caption text-foreground">Notificaciones</h3>
              </div>
              <button className="dropdown-item" role="menuitem">
                <span>No hay notificaciones nuevas</span>
              </button>
            </div>
          )}
        </div>

        {/* User Menu */}
        {user && (
          <div className="dropdown" ref={userMenuRef}>
            <button
              className="user-menu"
              onClick={() => { setUserMenuOpen(!userMenuOpen); setNotificationsOpen(false); }}
              aria-label="Menú de usuario"
              aria-expanded={userMenuOpen}
            >
              <div className="user-avatar">
                {user.nombre[0].toUpperCase()}
              </div>
              <div className="user-info">
                <p className="user-name">{user.nombre}</p>
                <p className="user-role">{user.rol}</p>
              </div>
              <ChevronDown size={16} className={`transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {userMenuOpen && (
              <div className="dropdown-menu" role="menu">
                <div className="p-3 border-b border-border">
                  <p className="body-sm text-foreground">{user.nombre}</p>
                  <p className="caption text-primary">{user.rol}</p>
                </div>
                <Link href="/perfil" className="dropdown-item" role="menuitem">
                  <UserIcon size={16} />
                  <span>Mi Perfil</span>
                </Link>
                <Link href="/settings" className="dropdown-item" role="menuitem">
                  <Search size={16} />
                  <span>Configuración</span>
                </Link>
                <div className="dropdown-divider" />
                <button 
                  onClick={logout}
                  className="dropdown-item danger" 
                  role="menuitem"
                >
                  <LogOut size={16} />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
