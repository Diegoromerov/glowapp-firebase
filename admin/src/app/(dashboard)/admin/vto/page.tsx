'use client';

import React, { useState } from 'react';

interface VtoProduct {
  id: string;
  brand: string;
  name: string;
  category: string;
  hex: string;
  finish: string;
  price: number;
}

export default function VtoAdminPage() {
  const [products, setProducts] = useState<VtoProduct[]>([
    { id: 'mk-01', brand: "L'Oréal Paris", name: 'Color Riche Coral Sunset', category: 'makeup', hex: '#E05A47', finish: 'Mate', price: 14.99 },
    { id: 'mk-02', brand: 'MAC Cosmetics', name: 'Velvet Teddy Warm Nude', category: 'makeup', hex: '#C88A68', finish: 'Satinado', price: 24.50 },
    { id: 'nl-01', brand: 'OPI', name: 'Terracota Warm Elegance', category: 'nails', hex: '#B84A39', finish: 'Brillante', price: 12.50 },
    { id: 'nl-03', brand: 'Chanel', name: 'Le Vernis Deep Burgundy', category: 'nails', hex: '#4A0E17', finish: 'Satinado', price: 32.00 },
  ]);

  const [newBrand, setNewBrand] = useState('');
  const [newName, setNewName] = useState('');
  const [newHex, setNewHex] = useState('#E05A47');
  const [newCategory, setNewCategory] = useState('makeup');
  const [newFinish, setNewFinish] = useState('Mate');
  const [newPrice, setNewPrice] = useState('19.99');

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrand || !newName) return;

    const newItem: VtoProduct = {
      id: `vto-${Date.now()}`,
      brand: newBrand,
      name: newName,
      category: newCategory,
      hex: newHex,
      finish: newFinish,
      price: parseFloat(newPrice) || 19.99,
    };

    setProducts([newItem, ...products]);
    setNewBrand('');
    setNewName('');
  };

  return (
    <div className="p-8 max-w-6xl mx-auto text-slate-800">
      <h1 className="text-3xl font-bold mb-2">Gestión de Catálogo VTO Multimarca B2B</h1>
      <p className="text-slate-500 mb-8">Administra los productos de belleza y códigos de tono HEX recomendados por DeepSeek IA para simulación virtual.</p>

      {/* Formulario de Alta de Producto Multimarca */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
        <h2 className="text-xl font-semibold mb-4 text-slate-700">Añadir Nuevo Producto VTO (Marca Socio B2B)</h2>
        <form onSubmit={handleAddProduct} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Marca Patrocinadora</label>
            <input
              type="text"
              placeholder="Ej. MAC Cosmetics"
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Nombre del Producto / Tono</label>
            <input
              type="text"
              placeholder="Ej. Ruby Woo"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Categoría VTO</label>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
            >
              <option value="makeup">Maquillaje (Rostro/Labios)</option>
              <option value="nails">Manicura & Uñas</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Código de Tono (HEX)</label>
            <div className="flex items-center space-x-2">
              <input
                type="color"
                value={newHex}
                onChange={(e) => setNewHex(e.target.value)}
                className="w-10 h-10 rounded border cursor-pointer"
              />
              <input
                type="text"
                value={newHex}
                onChange={(e) => setNewHex(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Acabado</label>
            <select
              value={newFinish}
              onChange={(e) => setNewFinish(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
            >
              <option value="Mate">Mate</option>
              <option value="Satinado">Satinado</option>
              <option value="Brillante">Brillante</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Precio E-Commerce ($ USD)</label>
            <input
              type="number"
              step="0.01"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <div className="md:col-span-3 pt-2">
            <button
              type="submit"
              className="bg-orange-600 hover:bg-orange-700 text-white font-medium px-6 py-2 rounded-lg text-sm transition-colors"
            >
              + Publicar Producto en VTO
            </button>
          </div>
        </form>
      </div>

      {/* Lista de Productos VTO Activos */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b font-medium text-slate-700">
          Catálogo Activo de Productos VTO Multimarca ({products.length} productos)
        </div>
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="bg-slate-100 border-b text-slate-600">
              <th className="p-3">Color</th>
              <th className="p-3">Marca</th>
              <th className="p-3">Producto</th>
              <th className="p-3">Categoría</th>
              <th className="p-3">Acabado</th>
              <th className="p-3">Precio</th>
            </tr>
          </thead>
          <tbody>
            {products.map((item) => (
              <tr key={item.id} className="border-b hover:bg-slate-50">
                <td className="p-3">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-full border shadow-inner" style={{ backgroundColor: item.hex }} />
                    <span className="font-mono text-xs text-slate-500">{item.hex}</span>
                  </div>
                </td>
                <td className="p-3 font-semibold text-slate-800">{item.brand}</td>
                <td className="p-3 text-slate-700">{item.name}</td>
                <td className="p-3 capitalize">{item.category === 'makeup' ? '💄 Maquillaje' : '💅 Manicura'}</td>
                <td className="p-3">{item.finish}</td>
                <td className="p-3 font-medium text-emerald-600">${item.price.toFixed(2)} USD</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
