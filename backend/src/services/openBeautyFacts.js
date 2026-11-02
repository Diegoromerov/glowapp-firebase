// backend/src/services/openBeautyFacts.js
const axios = require('axios');

class OpenBeautyFactsClient {
  constructor() {
    this.baseUrl = 'https://world.openbeautyfacts.org/api/v2';
    this.timeout = 5000;
  }

  /**
   * Busca un producto por código de barras
   */
  async searchByBarcode(barcode) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/product/${barcode}.json`,
        { timeout: this.timeout }
      );

      if (response.data.status === 1) {
        const product = response.data.product;
        return {
          barcode,
          name: product.product_name || 'Producto sin nombre',
          brand: product.brands || 'Marca desconocida',
          image: product.image_url || '',
          ingredients: product.ingredients_text || '',
          categories: product.categories || '',
          price: product.price || '',
        };
      }
      return null;
    } catch (error) {
      console.error('OpenBeautyFacts barcode error:', error.message);
      return null;
    }
  }

  /**
   * Busca productos por ingrediente
   */
  async searchByIngredient(ingredient, limit = 5) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/search`,
        {
          params: {
            ingredients: ingredient,
            page_size: limit,
            sort_by: 'popularity',
          },
          timeout: this.timeout,
        }
      );

      if (response.data.products && response.data.products.length > 0) {
        return response.data.products.slice(0, limit).map(p => ({
          barcode: p.barcode || '',
          name: p.product_name || 'Producto',
          brand: p.brands || 'Marca',
          image: p.image_url || '',
          ingredients: p.ingredients_text || '',
          categories: p.categories || '',
        }));
      }
      return [];
    } catch (error) {
      console.error('OpenBeautyFacts search error:', error.message);
      return [];
    }
  }

  /**
   * Obtiene productos recomendados a partir de una lista de ingredientes
   */
  async getRecommendedProducts(ingredients, limit = 5) {
    const allProducts = [];
    for (const ingredient of ingredients.slice(0, 3)) {
      const products = await this.searchByIngredient(ingredient, 2);
      allProducts.push(...products);
    }
    const seen = new Set();
    const unique = allProducts.filter(p => {
      if (seen.has(p.barcode)) return false;
      seen.add(p.barcode);
      return true;
    });
    return unique.slice(0, limit);
  }
}

module.exports = new OpenBeautyFactsClient();
