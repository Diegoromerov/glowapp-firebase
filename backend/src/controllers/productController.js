const { pool } = require('../config/db');
const { resolverPrecio, rolACodigoLista, conContextoDePlataforma } = require('../services/precioService');

// GET /api/products → Obtener catálogo de productos (filtrado por rol y nivel de precios)
exports.getProducts = async (req, res) => {
  try {
    const { tag } = req.query;
    const userRole = req.user ? req.user.role : 'client'; // 'client', 'provider', 'salon', 'admin'
    const codigoLista = rolACodigoLista(userRole);

    const executeGetProducts = async (dbClient) => {
      let query = `
        SELECT p.id, p.nombre, p.descripcion, p.stock, p.imagen_url, p.tag_especialidad, p.tipo_visibilidad,
               pp.precio, pp.unidad_minima
        FROM productos p
        INNER JOIN precios_producto pp ON pp.producto_id = p.id
        INNER JOIN listas_precios lp ON lp.id = pp.lista_id
        WHERE lp.codigo = $1
          AND lp.estado = 'ACTIVA'
          AND pp.precio IS NOT NULL
      `;
      const params = [codigoLista];

      if (tag) {
        query += ' AND p.tag_especialidad = $2';
        params.push(tag);
      }

      query += ' ORDER BY p.id ASC;';

      const { rows } = await dbClient.query(query, params);

      const formattedData = rows.map(r => ({
        id: r.id,
        nombre: r.nombre,
        descripcion: r.descripcion,
        precio: parseFloat(r.precio),
        unidad_minima: parseInt(r.unidad_minima, 10),
        stock: r.stock,
        imagen_url: r.imagen_url,
        tag_especialidad: r.tag_especialidad,
        tipo_visibilidad: r.tipo_visibilidad
      }));

      return res.json({
        success: true,
        count: formattedData.length,
        data: formattedData
      });
    };

    if (!req.user) {
      // Invitado público: ejecutar bajo contexto de plataforma explícito (sin BypassRLS)
      return await conContextoDePlataforma(pool, executeGetProducts);
    } else {
      return await executeGetProducts(pool);
    }
  } catch (error) {
    console.error('❌ ERROR EN GET /api/products:', error);
    return res.status(500).json({ error: 'Error al obtener productos' });
  }
};

// GET /api/products/:id → Obtener producto específico por ID
exports.getProductById = async (req, res) => {
  try {
    const productId = req.params.id;
    const userRole = req.user ? req.user.role : 'client';

    const executeGetProductById = async (dbClient) => {
      const { rows } = await dbClient.query(
        'SELECT id, nombre, descripcion, stock, imagen_url, tag_especialidad, tipo_visibilidad FROM productos WHERE id = $1;',
        [productId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      const product = rows[0];

      // Resolver precio por nivel de comprador
      const resPrecio = await resolverPrecio({
        rol: userRole,
        productoId: product.id,
        cantidad: 1
      });

      if (resPrecio.estado === 'sin_precio' || resPrecio.precio === null || resPrecio.precio === undefined) {
        return res.status(403).json({ error: 'No tienes acceso a este producto' });
      }

      const responseData = {
        id: product.id,
        nombre: product.nombre,
        descripcion: product.descripcion,
        precio: resPrecio.precio,
        unidad_minima: resPrecio.unidad_minima,
        stock: product.stock,
        imagen_url: product.imagen_url,
        tag_especialidad: product.tag_especialidad,
        tipo_visibilidad: product.tipo_visibilidad
      };

      return res.json({
        success: true,
        data: responseData
      });
    };

    if (!req.user) {
      return await conContextoDePlataforma(pool, executeGetProductById);
    } else {
      return await executeGetProductById(pool);
    }
  } catch (error) {
    console.error('❌ ERROR EN GET /api/products/:id:', error);
    return res.status(500).json({ error: 'Error al obtener producto' });
  }
};

// POST /api/admin/products → Cargar/crear nuevo producto (para el Dashboard)
exports.createProduct = async (req, res) => {
  try {
    const { 
      nombre, 
      descripcion, 
      costo,
      stock, 
      imagen_url, 
      tag_especialidad,
      sku,
      tipo_visibilidad
    } = req.body || {};

    if (!nombre || !tag_especialidad || costo === undefined || costo === null) {
      return res.status(400).json({ error: 'nombre, tag_especialidad y costo son obligatorios (lineamiento L21)' });
    }

    const numCosto = parseFloat(costo);
    if (isNaN(numCosto) || numCosto < 0) {
      return res.status(400).json({ error: 'costo debe ser un número mayor o igual a 0' });
    }

    let tenantId = req.user?.tenant_id;
    if (!tenantId) {
      const platRes = await pool.query('SELECT app_platform_tenant_id() AS tid');
      tenantId = platRes.rows[0]?.tid;
    }

    if (!tenantId) {
      return res.status(500).json({ error: 'No se pudo determinar el contexto del tenant para crear el producto' });
    }

    const query = `
      INSERT INTO productos (nombre, descripcion, costo, stock, imagen_url, tag_especialidad, tipo_visibilidad, sku, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, nombre, descripcion, costo, stock, imagen_url, tag_especialidad, tipo_visibilidad, sku, tenant_id;
    `;

    const { rows } = await pool.query(query, [
      nombre,
      descripcion || '',
      numCosto,
      stock !== undefined && stock !== null ? parseInt(stock, 10) : 0,
      imagen_url || '',
      tag_especialidad,
      tipo_visibilidad || 'PUBLICO',
      sku || null,
      tenantId
    ]);

    return res.status(201).json({
      success: true,
      data: rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR EN POST /api/admin/products:', error);
    return res.status(500).json({ error: 'Error al crear producto' });
  }
};

// PUT /api/admin/products/:id → Actualizar producto existente (para el Dashboard)
exports.updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const { 
      nombre, 
      descripcion, 
      costo,
      stock, 
      imagen_url, 
      tag_especialidad,
      sku,
      tipo_visibilidad
    } = req.body || {};

    if (!nombre || !tag_especialidad || costo === undefined || costo === null) {
      return res.status(400).json({ error: 'nombre, tag_especialidad y costo son obligatorios' });
    }

    const numCosto = parseFloat(costo);
    if (isNaN(numCosto) || numCosto < 0) {
      return res.status(400).json({ error: 'costo debe ser un número mayor o igual a 0' });
    }

    const query = `
      UPDATE productos 
      SET nombre = $1, descripcion = $2, costo = $3, stock = $4, imagen_url = $5, 
          tag_especialidad = $6, tipo_visibilidad = $7, sku = $8
      WHERE id = $9
      RETURNING id, nombre, descripcion, costo, stock, imagen_url, tag_especialidad, tipo_visibilidad, sku;
    `;

    const { rows } = await pool.query(query, [
      nombre,
      descripcion || '',
      numCosto,
      stock !== undefined && stock !== null ? parseInt(stock, 10) : 0,
      imagen_url || '',
      tag_especialidad,
      tipo_visibilidad || 'PUBLICO',
      sku || null,
      productId
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    return res.json({
      success: true,
      data: rows[0]
    });
  } catch (error) {
    console.error('❌ ERROR EN PUT /api/admin/products/:id:', error);
    return res.status(500).json({ error: 'Error al actualizar producto' });
  }
};

// DELETE /api/admin/products/:id → Eliminar producto de la base de datos (para el Dashboard)
exports.deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const { rowCount } = await pool.query('DELETE FROM productos WHERE id = $1;', [productId]);

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    return res.json({
      success: true,
      message: 'Producto eliminado con éxito'
    });
  } catch (error) {
    // Si viola la Foreign Key RESTRICT de precios_historial (o similar), responder 409
    if (error.code === '23503' || /precios_historial|violates foreign key constraint/i.test(error.message)) {
      return res.status(409).json({
        error: 'CONFLICT',
        message: 'El producto tiene historial de precios; desactívalo en vez de borrarlo'
      });
    }

    console.error('❌ ERROR EN DELETE /api/admin/products/:id:', error);
    return res.status(500).json({ error: 'Error al eliminar producto' });
  }
};

// GET /api/admin/products → Listado paginado del catálogo para el panel admin.
//
// El panel (admin-dashboard/src/app/(dashboard)/admin/productos/page.tsx) pide
// `/api/admin/products?page=N&limit=M` y lee `data.data || data.filas` y
// `data.total || data.count`. Antes de este handler la ruta solo existía para
// POST/PUT/DELETE, así que el listado caía en el 404 genérico del backend
// ("Ruta API no encontrada: GET /api/admin/products").
exports.getAdminProducts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitSolicitado = parseInt(req.query.limit, 10) || 20;
    // Tope duro: evita volcar el catálogo completo en una sola petición.
    const limit = Math.min(Math.max(limitSolicitado, 1), 100);
    const offset = (page - 1) * limit;

    const busqueda = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const filtro = busqueda ? 'WHERE (p.nombre ILIKE $1 OR p.sku ILIKE $1)' : '';
    const paramsFiltro = busqueda ? [`%${busqueda}%`] : [];

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM productos p ${filtro};`,
      paramsFiltro
    );
    const total = countRes.rows[0]?.total || 0;

    const { rows } = await pool.query(
      `SELECT p.id, p.nombre, p.descripcion, p.costo, p.stock, p.imagen_url,
              p.tag_especialidad, p.tipo_visibilidad, p.sku, p.tenant_id
         FROM productos p
         ${filtro}
        ORDER BY p.id ASC
        LIMIT $${paramsFiltro.length + 1} OFFSET $${paramsFiltro.length + 2};`,
      [...paramsFiltro, limit, offset]
    );

    return res.json({ success: true, page, limit, total, data: rows });
  } catch (error) {
    console.error('❌ ERROR EN GET /api/admin/products:', error);
    return res.status(500).json({ error: 'Error al listar productos', message: error.message });
  }
};
