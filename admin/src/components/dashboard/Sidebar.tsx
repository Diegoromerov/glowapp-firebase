'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ThemeSelector } from '@/components/ui/theme-selector';
import { 
  Home, 
  Calendar, 
  MessageSquare, 
  LogOut, 
  User as UserIcon,
  Scissors,
  GraduationCap,
  LayoutDashboard,
  Building2,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Inbox,
  Receipt,
  ShoppingCart,
  WalletCards,
  Truck,
  RotateCcw,
  UserRoundCheck,
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Reclamaciones: pathname === '/admin/pqrsf' || pathname.startsWith('/admin/disputas'),
    Tienda: ['/admin/precios', '/admin/productos', '/admin/store/orders'].some((path) => pathname === path || pathname.startsWith(`${path}/`)),
    Proveedores: ['/admin/proveedores/validacion', '/admin/prestadores'].some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  });

  // El botón hamburguesa del Header emite este evento (el estado del drawer
  // vive aquí, no en el layout).
  useEffect(() => {
    const toggle = () => setSidebarOpen((v) => !v);
    window.addEventListener('glow:toggle-sidebar', toggle);
    return () => window.removeEventListener('glow:toggle-sidebar', toggle);
  }, []);

  useEffect(() => {
    const rutasPorGrupo: Record<string, string[]> = {
      Reclamaciones: ['/admin/pqrsf', '/admin/disputas'],
      Tienda: ['/admin/precios', '/admin/productos', '/admin/store/orders'],
      Proveedores: ['/admin/proveedores/validacion', '/admin/prestadores'],
    };
    setOpenGroups((current) => Object.fromEntries(
      Object.entries(rutasPorGrupo).map(([group, paths]) => [
        group,
        current[group] || paths.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
      ]),
    ));
  }, [pathname]);

  // Links based on role
  const getLinks = () => {
    if (user?.rol === 'PRESTADOR') {
      return [
        { href: '/prestador', label: 'Panel Principal', icon: LayoutDashboard },
        { href: '/prestador/citas', label: 'Mis Citas', icon: Calendar },
        { href: '/chat', label: 'Mensajes', icon: MessageSquare },
        { href: '/perfil', label: 'Mi Perfil', icon: UserIcon },
      ];
    }
    
    if (user?.rol === 'ADMIN') {
      return [
        { href: '/admin/sos', label: 'Alertas SOS', icon: ShieldAlert },
        {
          label: 'Reclamaciones',
          icon: Inbox,
          children: [
            { href: '/admin/pqrsf', label: 'PQRSF' },
            { href: '/admin/disputas', label: 'Disputas' },
          ],
        },
        { href: '/admin/business', label: 'Cumplimiento Business', icon: Building2 },
        {
          label: 'Proveedores',
          icon: UserRoundCheck,
          children: [
            { href: '/admin/proveedores/validacion', label: 'Validación' },
            { href: '/admin/prestadores', label: 'RUT e IVA' },
          ],
        },
        { href: '/admin/retiros', label: 'Cuentas de retiro', icon: WalletCards },
        {
          label: 'Tienda',
          icon: ShoppingCart,
          children: [
            { href: '/admin/precios', label: 'Gestión de Precios' },
            { href: '/admin/productos', label: 'Catálogo de Productos' },
            { href: '/admin/store/orders', label: 'Pedidos GlowStore' },
          ],
        },
        { href: '/admin/logistics', label: 'Logística GlowStore', icon: Truck },
        { href: '/admin/logistics/returns', label: 'Devoluciones GlowStore', icon: RotateCcw },
        { href: '/admin/academia', label: 'Academia Glow', icon: GraduationCap },
        { href: '/chat', label: 'Mensajes', icon: MessageSquare },
        { href: '/perfil', label: 'Mi Perfil', icon: UserIcon },
      ];
    }
    
    // CLIENTE
    return [
      { href: '/cliente', label: 'Panel Principal', icon: Home },
      { href: '/cliente/citas', label: 'Mis Citas', icon: Calendar },
      { href: '/chat', label: 'Mensajes', icon: MessageSquare },
      { href: '/perfil', label: 'Mi Perfil', icon: UserIcon },
    ];
  };

  const links = getLinks();

  return (
    <>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="sidebar-overlay visible"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`} style={{ width: collapsed ? '72px' : '260px' }}>
        <div className="sidebar-brand">
          <Link href="/" className="sidebar-logo" aria-label="GlowAdmin Home">
            <div className="sidebar-logo-icon">
              <Scissors size={22} />
            </div>
            {!collapsed && (
              <div>
                <h1 className="sidebar-logo-text">GlowAdmin</h1>
                <p className="caption">Panel de Control</p>
              </div>
            )}
          </Link>
          {!collapsed && (
            <div className="flex justify-center mt-4">
              <ThemeSelector />
            </div>
          )}
        </div>

        <nav className="sidebar-nav" role="navigation" aria-label="Navegación principal">
          {links.map((link) => {
            const Icon = link.icon;
            if ('children' in link && link.children) {
              const isActive = link.children.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`));
              const isOpen = Boolean(openGroups[link.label]);
              const submenuId = `${link.label.toLowerCase()}-subnav`;
              return (
                <React.Fragment key={link.label}>
                  <button
                    type="button"
                    onClick={() => {
                      if (collapsed) setCollapsed(false);
                      setOpenGroups((groups) => ({ ...groups, [link.label]: !groups[link.label] }));
                    }}
                    className={`nav-link w-full text-left ${isActive ? 'active' : ''}`}
                    aria-expanded={isOpen}
                    aria-controls={submenuId}
                    title={collapsed ? link.label : undefined}
                  >
                    <Icon className="icon" size={20} aria-hidden="true" />
                    {!collapsed && <span>{link.label}</span>}
                    {!collapsed && <ChevronDown className={`ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} size={16} aria-hidden="true" />}
                  </button>
                  {!collapsed && isOpen && (
                    <div id={submenuId} className="sidebar-subnav">
                      {link.children.map((child) => {
                        const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setSidebarOpen(false)}
                            className={`nav-link nav-sublink ${childActive ? 'active' : ''}`}
                            aria-current={childActive ? 'page' : undefined}
                          >
                            <span>{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </React.Fragment>
              );
            }
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setSidebarOpen(false)}
                className={`nav-link ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? link.label : undefined}
              >
                <Icon className="icon" size={20} aria-hidden="true" />
                {!collapsed && <span>{link.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border mt-auto">
          {!collapsed && user && (
            <div className="flex items-center gap-3 mb-4">
              <div className="user-avatar">
                {user.nombre[0].toUpperCase()}
              </div>
              <div className="overflow-hidden min-w-0">
                <p className="body-sm text-primary truncate">{user.nombre}</p>
                <p className="micro text-primary font-medium uppercase tracking-wide">{user.rol}</p>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <button
              onClick={logout}
              className="btn btn-secondary w-full justify-start"
              title={collapsed ? 'Cerrar Sesión' : undefined}
            >
              <LogOut size={20} className="icon" aria-hidden="true" />
              {!collapsed && <span>Cerrar Sesión</span>}
            </button>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="btn btn-tertiary p-2"
              aria-label={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
            >
              {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
