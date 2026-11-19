// `deneme --ornek` için tek ürünlük örnek mağaza. Gerçek mağazaya bağlanmadan yapay zekâyı denemeye yarar.
export function sampleCommerce(publicUrl = 'https://ornek-magaza.com') {
  const variant = { id: '1001', title: '500 ml', sku: 'KASE-500', priceKurus: 14190, available: true, stock: 12 };
  const product = { id: '10', title: 'Sızdırmaz Kase 500 ml', url: `${publicUrl}/products/sizdirmaz-kase-500-ml`, paketIcerigi: '50 adet kase + 50 adet kapak', description: 'Paket içeriği: 50 adet kase + 50 adet kapak', variants: [variant] };
  return {
    name: 'ornek',
    async searchProducts() { return [product]; },
    async getProduct(id) { return id === product.id ? product : null; },
    async getVariant(id) { return id === variant.id ? variant : null; },
    async findCustomer() { return null; },
    async customerOrders() { return []; },
    async orderByNumber() { return null; },
    cartLink(items) { return `${publicUrl}/cart/${items.map((i) => `${i.variantId}:${i.quantity}`).join(',')}`; },
    async createPaymentLink() { return `${publicUrl}/invoices/ornek`; },
  };
}
