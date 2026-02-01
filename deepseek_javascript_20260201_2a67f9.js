import { db } from './firebase.js';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let allOrders = [];
let allProducts = [];
let shopSettings = {
    deliveryCharge: 0,
    chargePerKm: 10,
    baseCharge: 20,
    minOrderAmount: 0,
    freeDeliveryAbove: 500,
    shopLocation: { lat: 0, lng: 0 },
    supportNumber: "8090315246",
    isClosed: false
};

window.initAdmin = async () => {
    // 1. Load Shop Settings
    const shopSettingsRef = doc(db, "shopControl", "status");
    const shopSettingsSnap = await getDoc(shopSettingsRef);
    
    if (shopSettingsSnap.exists()) {
        const data = shopSettingsSnap.data();
        shopSettings = { ...shopSettings, ...data };
        
        // Update UI
        document.getElementById('shop-toggle').checked = data.isClosed || false;
        document.getElementById('status-label').innerText = data.isClosed ? "CLOSED" : "OPEN";
        document.getElementById('delivery-base-input').value = data.baseCharge || 20;
        document.getElementById('charge-per-km').value = data.chargePerKm || 10;
        document.getElementById('min-order-input').value = data.minOrderAmount || 0;
        document.getElementById('free-delivery-input').value = data.freeDeliveryAbove || 500;
        document.getElementById('support-number-input').value = data.supportNumber || "8090315246";
        
        // Shop location
        if (data.shopLocation) {
            document.getElementById('shop-lat').value = data.shopLocation.lat || 0;
            document.getElementById('shop-lng').value = data.shopLocation.lng || 0;
            document.getElementById('shop-address').value = data.shopAddress || "";
        }
        
        // Realtime listener for changes
        onSnapshot(shopSettingsRef, (docSnap) => {
            if (docSnap.exists()) {
                const updatedData = docSnap.data();
                shopSettings = { ...shopSettings, ...updatedData };
                
                document.getElementById('shop-toggle').checked = updatedData.isClosed || false;
                document.getElementById('status-label').innerText = updatedData.isClosed ? "CLOSED" : "OPEN";
            }
        });
    } else {
        // Create default settings
        await setDoc(shopSettingsRef, shopSettings);
    }

    // 2. Orders Real-time Listener
    onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc")), (snap) => {
        allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderOrders();
        updateStats();
    });

    // 3. Products Real-time Listener
    onSnapshot(collection(db, "products"), (snap) => {
        allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderProducts();
    });

    // 4. Categories Real-time Listener
    onSnapshot(collection(db, "categories"), (snap) => {
        const cats = snap.docs.map(d => ({id: d.id, ...d.data()}));
        renderCategories(cats);
    });
    
    // 5. Initialize map for location selection
    initLocationMap();
};

// Initialize location map
function initLocationMap() {
    const mapPreview = document.getElementById('map-preview');
    const latInput = document.getElementById('shop-lat');
    const lngInput = document.getElementById('shop-lng');
    const addressInput = document.getElementById('shop-address');
    
    // Use current location button
    document.getElementById('use-current-location').onclick = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                latInput.value = lat;
                lngInput.value = lng;
                
                // Get address from coordinates
                try {
                    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
                    const data = await response.json();
                    addressInput.value = data.display_name || "Address found";
                    mapPreview.innerHTML = `<p><i class="fas fa-check-circle"></i> Location set: ${lat.toFixed(4)}, ${lng.toFixed(4)}</p>`;
                } catch (error) {
                    addressInput.value = "Location set";
                    mapPreview.innerHTML = `<p><i class="fas fa-map-marker-alt"></i> Coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}</p>`;
                }
            });
        }
    };
    
    // Address lookup
    document.getElementById('lookup-address').onclick = async () => {
        const address = addressInput.value.trim();
        if (address) {
            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
                const data = await response.json();
                
                if (data && data[0]) {
                    latInput.value = data[0].lat;
                    lngInput.value = data[0].lon;
                    mapPreview.innerHTML = `<p><i class="fas fa-check-circle"></i> Address found: ${data[0].display_name}</p>`;
                } else {
                    mapPreview.innerHTML = `<p><i class="fas fa-exclamation-circle"></i> Address not found</p>`;
                }
            } catch (error) {
                mapPreview.innerHTML = `<p><i class="fas fa-exclamation-circle"></i> Lookup error</p>`;
            }
        }
    };
}

function updateStats() {
    let totalRevenue = 0;
    let totalOrders = 0;
    let pendingOrders = 0;
    let deliveredOrders = 0;
    
    allOrders.forEach(order => {
        if (order.status === 'delivered') {
            totalRevenue += order.total || 0;
            deliveredOrders++;
        }
        if (order.status === 'pending') {
            pendingOrders++;
        }
        totalOrders++;
    });
    
    document.getElementById('total-rev-val').innerText = '₹' + totalRevenue.toLocaleString();
    document.getElementById('total-orders-val').innerText = totalOrders;
    document.getElementById('pending-orders-val').innerText = pendingOrders;
    document.getElementById('delivered-orders-val').innerText = deliveredOrders;
    
    // Update chart if exists
    updateRevenueChart(allOrders);
}

function renderOrders() {
    const start = document.getElementById('filter-start').value;
    const end = document.getElementById('filter-end').value;
    
    const filteredOrders = allOrders.filter(order => {
        if (!order.createdAt) return true;
        const orderDate = order.createdAt.toDate();
        if (start && orderDate < new Date(start)) return false;
        if (end && orderDate > new Date(end + 'T23:59:59')) return false;
        return true;
    });
    
    document.getElementById('admin-orders').innerHTML = filteredOrders.map(order => {
        const date = order.createdAt ? order.createdAt.toDate() : new Date();
        const itemsList = order.items ? order.items.map(i => `${i.name} (x${i.qty})`).join(', ') : 'No items';
        
        return `
            <tr>
                <td>
                    <small>${date.toLocaleDateString()}</small><br>
                    <small>${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>
                </td>
                <td>
                    <div class="customer-info">
                        <strong>${order.customerName || 'Unknown'}</strong><br>
                        <small>${order.customerPhone || 'No phone'}</small><br>
                        <small class="address">${order.customerAddress || 'No address'}</small>
                    </div>
                </td>
                <td>
                    <small>${itemsList}</small>
                </td>
                <td>₹${order.total || 0}</td>
                <td><span class="status-tag status-${order.status}">${order.status}</span></td>
                <td>
                    <select onchange="upStatus('${order.id}', this.value)" class="status-select">
                        <option value="pending" ${order.status==='pending'?'selected':''}>Pending</option>
                        <option value="confirmed" ${order.status==='confirmed'?'selected':''}>Confirmed</option>
                        <option value="packed" ${order.status==='packed'?'selected':''}>Packed</option>
                        <option value="shipped" ${order.status==='shipped'?'selected':''}>Shipped</option>
                        <option value="delivered" ${order.status==='delivered'?'selected':''}>Delivered</option>
                        <option value="cancelled" ${order.status==='cancelled'?'selected':''}>Cancelled</option>
                    </select>
                    <button onclick="viewOrderDetails('${order.id}')" class="btn-small">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>`;
    }).join('');
}

function renderProducts() {
    document.getElementById('admin-inventory').innerHTML = allProducts.map(p => `
        <tr>
            <td>
                <div class="product-row">
                    <img src="${p.imageUrl || 'https://via.placeholder.com/50'}" 
                         class="product-thumb"
                         alt="${p.name}">
                    <div>
                        <strong>${p.name}</strong><br>
                        <small>${p.category || 'Uncategorized'}</small>
                    </div>
                </div>
            </td>
            <td>
                <select onchange="updateStock('${p.id}', this.value)" class="stock-select">
                    <option value="Available" ${p.status==='Available'?'selected':''}>Available</option>
                    <option value="Low Stock" ${p.stock < 10 && p.stock > 0 ? 'selected' : ''}>Low Stock</option>
                    <option value="Out of Stock" ${p.status==='Out of Stock'?'selected':''}>Out of Stock</option>
                    <option value="Unavailable" ${p.status==='Unavailable'?'selected':''}>Unavailable</option>
                </select>
                <input type="number" 
                       value="${p.stock || 0}" 
                       onchange="updateStockCount('${p.id}', this.value)"
                       class="stock-input"
                       placeholder="Qty">
            </td>
            <td>
                <div class="price-edit">
                    <input type="number" 
                           value="${p.price}" 
                           onchange="updatePrice('${p.id}', this.value)"
                           class="price-input">
                    <select onchange="updateUnit('${p.id}', this.value)" class="unit-select">
                        <option value="piece" ${p.unit==='piece'?'selected':''}>piece</option>
                        <option value="kg" ${p.unit==='kg'?'selected':''}>kg</option>
                        <option value="gram" ${p.unit==='gram'?'selected':''}>gram</option>
                        <option value="bunch" ${p.unit==='bunch'?'selected':''}>bunch</option>
                        <option value="pack" ${p.unit==='pack'?'selected':''}>pack</option>
                    </select>
                </div>
            </td>
            <td>
                <div class="product-actions">
                    <button onclick="editProduct('${p.id}')" class="btn-edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="toggleFeatured('${p.id}', ${!p.featured})" 
                            class="btn-featured ${p.featured ? 'active' : ''}">
                        <i class="fas fa-star"></i>
                    </button>
                    <button onclick="deleteProduct('${p.id}')" class="btn-delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>`).join('');
}

function renderCategories(cats) {
    const categorySelect = document.getElementById('p-category');
    categorySelect.innerHTML = '<option value="">Select Category</option>' +
        cats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    
    document.getElementById('admin-cat-list').innerHTML = cats.map(c => `
        <div class="category-item">
            <span class="category-name">${c.icon || '📦'} ${c.name}</span>
            <div class="category-actions">
                <button onclick="editCategory('${c.id}', '${c.name}')" class="btn-small">
                    <i class="fas fa-edit"></i>
                </button>
                <button onclick="deleteCategory('${c.id}')" class="btn-small btn-danger">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>`).join('');
}

// Enhanced Functions
window.applyFilters = () => renderOrders();

window.upStatus = async (id, status) => {
    try {
        await updateDoc(doc(db, "orders", id), { 
            status: status,
            updatedAt: serverTimestamp()
        });
        showNotification(`Order status updated to ${status}`, "success");
    } catch (error) {
        showNotification("Error updating status", "error");
    }
};

window.updateStock = async (id, status) => {
    try {
        await updateDoc(doc(db, "products", id), { 
            status: status,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating stock:", error);
    }
};

window.updateStockCount = async (id, count) => {
    try {
        await updateDoc(doc(db, "products", id), { 
            stock: parseInt(count) || 0,
            status: parseInt(count) > 0 ? 'Available' : 'Out of Stock',
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating stock count:", error);
    }
};

window.updatePrice = async (id, price) => {
    try {
        await updateDoc(doc(db, "products", id), { 
            price: parseInt(price) || 0,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating price:", error);
    }
};

window.updateUnit = async (id, unit) => {
    try {
        await updateDoc(doc(db, "products", id), { 
            unit: unit,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating unit:", error);
    }
};

window.toggleFeatured = async (id, featured) => {
    try {
        await updateDoc(doc(db, "products", id), { 
            featured: featured,
            updatedAt: serverTimestamp()
        });
        showNotification(`Product ${featured ? 'added to' : 'removed from'} featured`, "success");
    } catch (error) {
        showNotification("Error updating featured status", "error");
    }
};

window.updateShopSettings = async () => {
    try {
        const settings = {
            isClosed: document.getElementById('shop-toggle').checked,
            baseCharge: parseInt(document.getElementById('delivery-base-input').value) || 20,
            chargePerKm: parseInt(document.getElementById('charge-per-km').value) || 10,
            minOrderAmount: parseInt(document.getElementById('min-order-input').value) || 0,
            freeDeliveryAbove: parseInt(document.getElementById('free-delivery-input').value) || 500,
            supportNumber: document.getElementById('support-number-input').value,
            shopLocation: {
                lat: parseFloat(document.getElementById('shop-lat').value) || 0,
                lng: parseFloat(document.getElementById('shop-lng').value) || 0
            },
            shopAddress: document.getElementById('shop-address').value,
            updatedAt: serverTimestamp()
        };
        
        await setDoc(doc(db, "shopControl", "status"), settings, { merge: true });
        showNotification("Settings saved successfully!", "success");
        
        // Update local settings
        shopSettings = { ...shopSettings, ...settings };
    } catch (error) {
        showNotification("Error saving settings: " + error.message, "error");
    }
};

window.addProduct = async () => {
    const name = document.getElementById('p-name').value.trim();
    const price = parseInt(document.getElementById('p-price').value);
    const category = document.getElementById('p-category').value;
    
    if (!name || !price || !category) {
        showNotification("Please fill all required fields", "error");
        return;
    }
    
    try {
        await addDoc(collection(db, "products"), { 
            name, 
            price,
            unit: document.getElementById('p-unit').value || 'piece',
            imageUrl: document.getElementById('p-img').value || '',
            category: category,
            description: document.getElementById('p-desc').value || '',
            stock: parseInt(document.getElementById('p-stock').value) || 10,
            status: 'Available',
            featured: document.getElementById('p-featured').checked,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        
        showNotification("Product added successfully!", "success");
        
        // Clear form
        document.getElementById('p-name').value = '';
        document.getElementById('p-price').value = '';
        document.getElementById('p-desc').value = '';
        document.getElementById('p-img').value = '';
        document.getElementById('p-stock').value = '10';
        document.getElementById('p-featured').checked = false;
    } catch (error) {
        showNotification("Error adding product: " + error.message, "error");
    }
};

window.addCategory = async () => {
    const name = document.getElementById('new-cat-name').value.trim();
    const icon = document.getElementById('new-cat-icon').value || '📦';
    
    if (!name) {
        showNotification("Please enter category name", "error");
        return;
    }
    
    try {
        await addDoc(collection(db, "categories"), { 
            name: name,
            icon: icon,
            createdAt: serverTimestamp()
        });
        
        document.getElementById('new-cat-name').value = '';
        document.getElementById('new-cat-icon').value = '📦';
        showNotification("Category added successfully!", "success");
    } catch (error) {
        showNotification("Error adding category: " + error.message, "error");
    }
};

window.editProduct = (id) => {
    const product = allProducts.find(p => p.id === id);
    if (!product) return;
    
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = product.name;
    document.getElementById('edit-price').value = product.price;
    document.getElementById('edit-unit').value = product.unit || 'piece';
    document.getElementById('edit-img').value = product.imageUrl || '';
    document.getElementById('edit-desc').value = product.description || '';
    document.getElementById('edit-category').value = product.category || '';
    document.getElementById('edit-stock').value = product.stock || 0;
    document.getElementById('edit-featured').checked = product.featured || false;
    
    document.getElementById('edit-modal').classList.add('active');
};

window.saveEdit = async () => {
    const id = document.getElementById('edit-id').value;
    
    try {
        await updateDoc(doc(db, "products", id), {
            name: document.getElementById('edit-name').value,
            price: parseInt(document.getElementById('edit-price').value) || 0,
            unit: document.getElementById('edit-unit').value,
            imageUrl: document.getElementById('edit-img').value,
            description: document.getElementById('edit-desc').value,
            category: document.getElementById('edit-category').value,
            stock: parseInt(document.getElementById('edit-stock').value) || 0,
            featured: document.getElementById('edit-featured').checked,
            updatedAt: serverTimestamp()
        });
        
        document.getElementById('edit-modal').classList.remove('active');
        showNotification("Product updated successfully!", "success");
    } catch (error) {
        showNotification("Error updating product: " + error.message, "error");
    }
};

window.deleteProduct = async (id) => { 
    if (confirm("Are you sure you want to delete this product?")) {
        try {
            await deleteDoc(doc(db, "products", id));
            showNotification("Product deleted successfully!", "success");
        } catch (error) {
            showNotification("Error deleting product", "error");
        }
    }
};

window.deleteCategory = async (id) => { 
    if (confirm("Are you sure you want to delete this category? Products in this category will become uncategorized.")) {
        try {
            await deleteDoc(doc(db, "categories", id));
            showNotification("Category deleted successfully!", "success");
        } catch (error) {
            showNotification("Error deleting category", "error");
        }
    }
};

window.editCategory = (id, currentName) => {
    const newName = prompt("Enter new category name:", currentName);
    if (newName && newName !== currentName) {
        updateDoc(doc(db, "categories", id), {
            name: newName,
            updatedAt: serverTimestamp()
        });
    }
};

window.viewOrderDetails = (orderId) => {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;
    
    const modal = document.getElementById('order-details-modal');
    const itemsHtml = order.items ? order.items.map(item => `
        <div class="order-item-detail">
            <span>${item.name} x ${item.qty}</span>
            <span>₹${item.price * item.qty}</span>
        </div>
    `).join('') : '';
    
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Order Details #${orderId.substring(0, 8)}</h3>
            <div class="order-details">
                <p><strong>Customer:</strong> ${order.customerName}</p>
                <p><strong>Phone:</strong> ${order.customerPhone}</p>
                <p><strong>Address:</strong> ${order.customerAddress}</p>
                <p><strong>Status:</strong> <span class="status-tag status-${order.status}">${order.status}</span></p>
                <p><strong>Date:</strong> ${order.createdAt ? order.createdAt.toDate().toLocaleString() : 'N/A'}</p>
                
                <h4>Items:</h4>
                ${itemsHtml}
                
                <div class="order-totals">
                    <p><strong>Subtotal:</strong> ₹${order.itemsTotal || 0}</p>
                    <p><strong>Delivery:</strong> ₹${order.deliveryCharge || 0}</p>
                    <p><strong>Packing:</strong> ₹${order.packingCharge || 0}</p>
                    <p><strong>Discount:</strong> -₹${order.discount || 0}</p>
                    <p><strong>Total:</strong> ₹${order.total || 0}</p>
                </div>
                
                ${order.specialInstructions ? `<p><strong>Instructions:</strong> ${order.specialInstructions}</p>` : ''}
            </div>
            <button onclick="this.closest('.modal').classList.remove('active')" class="btn-primary">Close</button>
        </div>
    `;
    
    modal.classList.add('active');
};

// Update revenue chart
function updateRevenueChart(orders) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    
    // Group by date
    const revenueByDate = {};
    orders.forEach(order => {
        if (order.status === 'delivered' && order.createdAt) {
            const date = order.createdAt.toDate().toLocaleDateString();
            revenueByDate[date] = (revenueByDate[date] || 0) + (order.total || 0);
        }
    });
    
    const dates = Object.keys(revenueByDate).slice(-7); // Last 7 days
    const revenues = dates.map(date => revenueByDate[date]);
    
    // Create or update chart
    if (window.revenueChart) {
        window.revenueChart.data.labels = dates;
        window.revenueChart.data.datasets[0].data = revenues;
        window.revenueChart.update();
    } else {
        window.revenueChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Revenue (₹)',
                    data: revenues,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }
}

// Notification function
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }, 100);
}

// Export data
window.exportData = async (type) => {
    let data, filename, contentType;
    
    switch(type) {
        case 'orders':
            data = allOrders.map(order => ({
                ID: order.id,
                Date: order.createdAt ? order.createdAt.toDate().toLocaleString() : 'N/A',
                Customer: order.customerName,
                Phone: order.customerPhone,
                Address: order.customerAddress,
                Items: order.items ? order.items.map(i => `${i.name} x${i.qty}`).join(', ') : '',
                Total: order.total,
                Status: order.status
            }));
            filename = 'orders_export.csv';
            contentType = 'text/csv';
            break;
            
        case 'products':
            data = allProducts.map(product => ({
                Name: product.name,
                Category: product.category,
                Price: product.price,
                Unit: product.unit,
                Stock: product.stock,
                Status: product.status,
                Featured: product.featured ? 'Yes' : 'No'
            }));
            filename = 'products_export.csv';
            contentType = 'text/csv';
            break;
    }
    
    // Convert to CSV
    const csv = convertToCSV(data);
    downloadCSV(csv, filename, contentType);
};

function convertToCSV(objArray) {
    const array = typeof objArray !== 'object' ? JSON.parse(objArray) : objArray;
    let str = '';
    
    // Headers
    const headers = Object.keys(array[0]);
    str += headers.join(',') + '\r\n';
    
    // Data
    for (let i = 0; i < array.length; i++) {
        let line = '';
        for (let j = 0; j < headers.length; j++) {
            if (line !== '') line += ',';
            line += `"${array[i][headers[j]] || ''}"`;
        }
        str += line + '\r\n';
    }
    
    return str;
}

function downloadCSV(csv, filename, contentType) {
    const blob = new Blob([csv], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
}