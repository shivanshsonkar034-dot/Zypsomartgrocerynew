import { auth, db } from './firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { collection, onSnapshot, query, where, orderBy, addDoc, doc, serverTimestamp, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentUser = null;
let cart = JSON.parse(localStorage.getItem('zypso_cart')) || [];
let allProducts = [];
let currentCategory = 'all';
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
let userLocation = JSON.parse(localStorage.getItem('user_location')) || null;
let searchTerm = '';
let deliveryDistance = null;
let deliveryETA = null;

// Calculate distance using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

// Calculate delivery charge based on distance
function calculateDeliveryCharge(distance) {
    if (!distance) return shopSettings.baseCharge;
    
    let charge = shopSettings.baseCharge + (distance * shopSettings.chargePerKm);
    
    // Apply minimum charge
    charge = Math.max(charge, shopSettings.baseCharge);
    
    // Round to nearest 5
    charge = Math.ceil(charge / 5) * 5;
    
    return charge;
}

// Calculate ETA based on distance
function calculateETA(distance) {
    if (!distance) return 45;
    
    // Base time + time based on distance (assuming 30km/h average speed + 15 min prep)
    const travelTime = (distance / 30) * 60; // in minutes
    const eta = Math.round(15 + travelTime);
    
    return Math.min(Math.max(eta, 30), 120); // Between 30-120 minutes
}

// Update delivery information
function updateDeliveryInfo() {
    if (!userLocation || !shopSettings.shopLocation.lat) {
        document.getElementById('distance-value').textContent = '--';
        document.getElementById('eta-value').textContent = '--';
        document.getElementById('current-address').textContent = 'Set your location to calculate delivery charges';
        return;
    }
    
    const distance = calculateDistance(
        userLocation.lat, 
        userLocation.lng, 
        shopSettings.shopLocation.lat, 
        shopSettings.shopLocation.lng
    );
    
    deliveryDistance = distance;
    deliveryETA = calculateETA(distance);
    
    document.getElementById('distance-value').textContent = distance;
    document.getElementById('eta-value').textContent = deliveryETA;
    document.getElementById('current-address').textContent = userLocation.address || 'Location set';
    document.getElementById('location-display').innerHTML = `<i class="fas fa-map-marker-alt"></i> ${userLocation.address ? userLocation.address.substring(0, 30) + '...' : 'Location set'}`;
    
    updateCartUI();
}

// Update user location
window.updateUserLocation = async (lat, lng) => {
    try {
        // Get address from coordinates using reverse geocoding
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        
        userLocation = {
            lat,
            lng,
            address: data.display_name,
            timestamp: Date.now()
        };
        
        localStorage.setItem('user_location', JSON.stringify(userLocation));
        showToast("Location updated successfully!", "success");
        updateDeliveryInfo();
        
        // Hide location badge
        document.getElementById('location-badge').style.display = 'none';
        
    } catch (error) {
        console.error('Error getting address:', error);
        userLocation = { lat, lng, timestamp: Date.now() };
        localStorage.setItem('user_location', JSON.stringify(userLocation));
        showToast("Location set, but couldn't fetch address", "warning");
        updateDeliveryInfo();
    }
};

window.updateManualLocation = async (address) => {
    try {
        // Get coordinates from address
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
        const data = await response.json();
        
        if (data && data[0]) {
            userLocation = {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                address: address,
                timestamp: Date.now()
            };
            
            localStorage.setItem('user_location', JSON.stringify(userLocation));
            showToast("Location updated successfully!", "success");
            updateDeliveryInfo();
            
            // Hide location badge
            document.getElementById('location-badge').style.display = 'none';
        } else {
            showToast("Could not find this address", "error");
        }
    } catch (error) {
        console.error('Error geocoding address:', error);
        showToast("Error updating location", "error");
    }
};

// Authentication Listener
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const authBtn = document.getElementById('auth-btn');
    const myOrdersBtn = document.getElementById('my-orders-btn');

    if (user) {
        authBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i>';
        myOrdersBtn.style.display = "flex";
        
        authBtn.onclick = () => {
            if (confirm("Are you sure you want to logout?")) {
                signOut(auth);
                showToast("Logged out successfully", "success");
            }
        };
    } else {
        authBtn.innerHTML = '<i class="fas fa-user"></i>';
        myOrdersBtn.style.display = "none";
        
        authBtn.onclick = () => {
            document.getElementById('auth-modal').classList.add('active');
            document.getElementById('auth-email').focus();
        };
    }

    loadData();
    initGlobalListeners();
    
    // Show location badge if no location is set
    if (!userLocation && navigator.geolocation) {
        document.getElementById('location-badge').style.display = 'flex';
    }
});

// Global Listeners
function initGlobalListeners() {
    // Shop Control Listener
    onSnapshot(doc(db, "shopControl", "status"), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            shopSettings = { ...shopSettings, ...data };
            
            // Update support number
            if (data.supportNumber) {
                document.getElementById('support-link').href = `tel:${data.supportNumber}`;
                document.getElementById('support-display').textContent = data.supportNumber;
            }
            
            // Shop status
            const overlay = document.getElementById('shop-closed-overlay');
            if (data.isClosed) {
                overlay.style.display = 'flex';
                if (data.nextOpenTime) {
                    const nextOpen = data.nextOpenTime.toDate();
                    document.getElementById('opening-time-text').textContent = 'We\'ll be back soon!';
                    document.getElementById('next-opening').textContent = `Next opening: ${nextOpen.toLocaleString()}`;
                }
            } else {
                overlay.style.display = 'none';
            }
            
            // Update delivery info if shop location exists
            if (data.shopLocation) {
                shopSettings.shopLocation = data.shopLocation;
                updateDeliveryInfo();
            }
        }
    });
    
    // Auto-request location on first visit
    if (!userLocation && navigator.geolocation) {
        setTimeout(() => {
            if (confirm("Allow ZYPSO Mart to access your location for accurate delivery charges?")) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        window.updateUserLocation(position.coords.latitude, position.coords.longitude);
                    },
                    () => {
                        document.getElementById('location-badge').style.display = 'flex';
                    }
                );
            }
        }, 2000);
    }
}

// Load Data
function loadData() {
    // Products Listener
    onSnapshot(collection(db, "products"), (snap) => {
        allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => 
            (b.featured || false) - (a.featured || false)
        );
        renderProducts();
        document.getElementById('loading-indicator').style.display = 'none';
    });
    
    // Categories Listener
    onSnapshot(collection(db, "categories"), (snap) => {
        const list = document.getElementById('category-list');
        list.innerHTML = `<div class="category-chip ${currentCategory === 'all' ? 'active' : ''}" onclick="filterCat('all')">
            <i class="fas fa-th-large"></i> All
        </div>`;
        
        snap.docs.forEach(d => {
            const category = d.data();
            list.innerHTML += `<div class="category-chip ${currentCategory === category.name ? 'active' : ''}" onclick="filterCat('${category.name}')">
                ${category.icon || '📦'} ${category.name}
            </div>`;
        });
    });
}

// Search & Filter
window.filterCat = (cat) => { 
    currentCategory = cat; 
    renderProducts(); 
    
    // Update active state
    document.querySelectorAll('.category-chip').forEach(chip => {
        chip.classList.remove('active');
    });
    event.target.classList.add('active');
};

document.getElementById('product-search').oninput = (e) => { 
    searchTerm = e.target.value; 
    renderProducts(); 
};

// Product Rendering
function renderProducts() {
    const grid = document.getElementById('product-grid');
    const filtered = allProducts.filter(p => 
        (currentCategory === 'all' || p.category === currentCategory) &&
        (p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
         (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase())))
    );
    
    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="no-products">
                <i class="fas fa-search fa-3x"></i>
                <h3>No products found</h3>
                <p>Try searching for something else</p>
            </div>`;
        return;
    }
    
    grid.innerHTML = filtered.map(p => {
        const isUnavailable = p.status === "Unavailable" || p.status === "Out of Stock";
        const isFeatured = p.featured;
        
        return `
        <div class="product-card ${isUnavailable ? 'out-of-stock' : ''} ${isFeatured ? 'featured' : ''}">
            ${isUnavailable ? '<span class="status-badge">Out of Stock</span>' : ''}
            ${isFeatured ? '<span class="featured-badge"><i class="fas fa-star"></i> Featured</span>' : ''}
            
            <img src="${p.imageUrl || 'https://via.placeholder.com/300x200?text=No+Image'}" 
                 class="product-img" 
                 alt="${p.name}"
                 onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
            
            <div class="product-info">
                <h4>${p.name}</h4>
                <p class="product-desc">${p.description || 'Fresh product available'}</p>
                <div class="price-section">
                    <span class="price">₹${p.price}</span>
                    <span class="unit">/${p.unit || 'piece'}</span>
                </div>
                <div class="product-meta">
                    <span class="category">${p.category || 'General'}</span>
                    <span class="stock ${p.stock > 10 ? 'in-stock' : 'low-stock'}">
                        ${p.stock > 10 ? 'In Stock' : `Only ${p.stock} left`}
                    </span>
                </div>
            </div>
            
            <button onclick="addToCart('${p.id}')" 
                    class="btn-primary add-to-cart-btn" 
                    ${isUnavailable ? 'disabled' : ''}>
                <i class="fas fa-cart-plus"></i>
                ${isUnavailable ? 'Out of Stock' : 'Add to Cart'}
            </button>
        </div>`;
    }).join('');
}

// Cart Management
window.addToCart = (id) => {
    const p = allProducts.find(x => x.id === id);
    if (!p || p.status === "Unavailable" || p.status === "Out of Stock") return;
    
    const existing = cart.find(item => item.id === id);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({ 
            id: p.id,
            name: p.name,
            price: p.price,
            unit: p.unit || 'piece',
            imageUrl: p.imageUrl,
            qty: 1 
        });
    }
    
    localStorage.setItem('zypso_cart', JSON.stringify(cart));
    updateCartUI();
    showToast(`${p.name} added to cart`, "success");
    
    // Animate cart button
    const cartBtn = document.getElementById('cart-btn');
    cartBtn.classList.add('pulse');
    setTimeout(() => cartBtn.classList.remove('pulse'), 300);
};

window.updateQty = (id, delta) => {
    const item = cart.find(i => i.id === id);
    if (item) {
        item.qty += delta;
        if (item.qty <= 0) {
            cart = cart.filter(i => i.id !== id);
            showToast("Item removed from cart", "info");
        }
        localStorage.setItem('zypso_cart', JSON.stringify(cart));
        updateCartUI();
    }
};

function updateCartUI() {
    const container = document.getElementById('cart-items');
    let itemsTotal = 0;
    
    if (cart.length === 0) {
        container.innerHTML = `
            <div class="empty-cart">
                <i class="fas fa-shopping-cart fa-3x"></i>
                <h3>Your cart is empty</h3>
                <p>Add some fresh products to get started!</p>
            </div>`;
        document.getElementById('delivery-breakdown').style.display = 'none';
    } else {
        container.innerHTML = cart.map(item => {
            const itemTotal = item.price * item.qty;
            itemsTotal += itemTotal;
            
            return `
            <div class="cart-item">
                <div class="cart-item-info">
                    <img src="${item.imageUrl || 'https://via.placeholder.com/50'}" 
                         class="cart-item-img"
                         alt="${item.name}">
                    <div>
                        <b>${item.name}</b>
                        <small>₹${item.price} / ${item.unit}</small>
                    </div>
                </div>
                <div class="cart-item-controls">
                    <div class="qty-control">
                        <button onclick="updateQty('${item.id}', -1)">-</button>
                        <span class="qty-val">${item.qty}</span>
                        <button onclick="updateQty('${item.id}', 1)">+</button>
                    </div>
                    <div class="item-total">₹${itemTotal}</div>
                </div>
            </div>`;
        }).join('');
        
        document.getElementById('delivery-breakdown').style.display = 'block';
    }
    
    // Update cart count
    const totalItems = cart.reduce((a, b) => a + b.qty, 0);
    document.getElementById('cart-count').textContent = totalItems;
    
    // Calculate delivery charge
    let deliveryCharge = 0;
    if (deliveryDistance !== null) {
        deliveryCharge = calculateDeliveryCharge(deliveryDistance);
        
        // Apply free delivery for orders above threshold
        if (itemsTotal >= shopSettings.freeDeliveryAbove) {
            deliveryCharge = 0;
        }
    }
    
    const packingCharge = 10;
    const discount = itemsTotal > 1000 ? Math.round(itemsTotal * 0.05) : 0;
    const grandTotal = itemsTotal + deliveryCharge + packingCharge - discount;
    
    // Update breakdown
    document.getElementById('items-total').textContent = `₹${itemsTotal}`;
    document.getElementById('delivery-charge').textContent = `₹${deliveryCharge}`;
    document.getElementById('packing-charge').textContent = `₹${packingCharge}`;
    document.getElementById('discount-value').textContent = `-₹${discount}`;
    document.getElementById('cart-total').textContent = `₹${grandTotal}`;
    document.getElementById('cart-total-display').textContent = `₹${grandTotal}`;
    document.getElementById('total-savings').textContent = discount;
    
    // Show/hide checkout button based on min order
    const checkoutBtn = document.getElementById('checkout-btn');
    if (itemsTotal < shopSettings.minOrderAmount) {
        checkoutBtn.disabled = true;
        checkoutBtn.innerHTML = `<i class="fas fa-exclamation-circle"></i>
                                <span>Min order: ₹${shopSettings.minOrderAmount}</span>`;
    } else {
        checkoutBtn.disabled = false;
        checkoutBtn.innerHTML = `<i class="fas fa-shopping-bag"></i>
                                <span>Proceed to Checkout (₹${grandTotal})</span>
                                <span class="checkout-arrow">→</span>`;
    }
}

// Order Management
window.cancelOrder = async (id) => { 
    if (confirm("Are you sure you want to cancel this order?")) {
        try {
            await updateDoc(doc(db, "orders", id), { 
                status: "cancelled",
                cancelledAt: serverTimestamp() 
            });
            showToast("Order cancelled successfully", "success");
        } catch (error) {
            showToast("Error cancelling order", "error");
        }
    }
};

window.returnOrder = async (id) => { 
    if (confirm("Request a return for this order?")) {
        try {
            await updateDoc(doc(db, "orders", id), { 
                status: "return_pending",
                returnRequestedAt: serverTimestamp() 
            });
            showToast("Return requested successfully", "success");
        } catch (error) {
            showToast("Error requesting return", "error");
        }
    }
};

// Load user orders
function loadUserOrders() {
    if (!currentUser) return;
    
    const q = query(collection(db, "orders"), 
        where("userId", "==", currentUser.uid), 
        orderBy("createdAt", "desc"));
    
    onSnapshot(q, (snap) => {
        const ordersList = document.getElementById('user-orders-list');
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        if (orders.length === 0) {
            ordersList.innerHTML = `
                <div class="no-orders">
                    <i class="fas fa-box-open fa-3x"></i>
                    <h3>No orders yet</h3>
                    <p>Your orders will appear here</p>
                </div>`;
            return;
        }
        
        ordersList.innerHTML = orders.map(order => {
            const date = order.createdAt ? order.createdAt.toDate() : new Date();
            const itemsList = order.items ? order.items.map(i => `${i.name} (x${i.qty})`).join(', ') : 'No items';
            
            return `
            <div class="order-card">
                <div class="order-header">
                    <div>
                        <small>${date.toLocaleDateString()} • ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>
                        <h4>Order #${order.id.substring(0, 8)}</h4>
                    </div>
                    <span class="status-tag status-${order.status}">
                        ${order.status.replace('_', ' ')}
                    </span>
                </div>
                
                <div class="order-items">
                    <p>${itemsList}</p>
                </div>
                
                <div class="order-footer">
                    <div class="order-total">
                        <b>₹${order.total || 0}</b>
                    </div>
                    <div class="order-actions">
                        ${order.status === 'pending' ? 
                            `<button onclick="cancelOrder('${order.id}')" class="btn-cancel">
                                <i class="fas fa-times"></i> Cancel
                            </button>` : ''}
                        ${order.status === 'delivered' ? 
                            `<button onclick="returnOrder('${order.id}')" class="btn-secondary">
                                <i class="fas fa-undo"></i> Return
                            </button>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
    });
}

// Checkout Flow
document.getElementById('checkout-btn').onclick = async () => {
    if (!currentUser) {
        showToast("Please login to place an order", "warning");
        document.getElementById('auth-modal').classList.add('active');
        document.getElementById('sidebar-overlay').classList.remove('active');
        return;
    }
    
    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
    const address = document.getElementById('cust-address').value.trim();
    const instructions = document.getElementById('instructions').value.trim();
    
    // Validation
    if (!name || !phone || !address || cart.length === 0) {
        showToast("Please fill all required details", "error");
        return;
    }
    
    if (phone.length < 10) {
        showToast("Please enter a valid phone number", "error");
        return;
    }
    
    if (!userLocation) {
        showToast("Please set your delivery location first", "error");
        openLocationModal();
        return;
    }
    
    // Calculate total
    const itemsTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const deliveryCharge = calculateDeliveryCharge(deliveryDistance);
    const packingCharge = 10;
    const discount = itemsTotal > 1000 ? Math.round(itemsTotal * 0.05) : 0;
    const grandTotal = itemsTotal + deliveryCharge + packingCharge - discount;
    
    try {
        const orderRef = await addDoc(collection(db, "orders"), {
            userId: currentUser.uid,
            customerName: name,
            customerPhone: phone,
            customerAddress: address,
            customerLocation: userLocation,
            items: cart,
            itemsTotal: itemsTotal,
            deliveryCharge: deliveryCharge,
            packingCharge: packingCharge,
            discount: discount,
            total: grandTotal,
            status: 'pending',
            deliveryETA: deliveryETA,
            specialInstructions: instructions,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        
        showToast(`Order #${orderRef.id.substring(0, 8)} placed successfully!`, "success");
        
        // Clear cart
        cart = [];
        localStorage.removeItem('zypso_cart');
        updateCartUI();
        
        // Close cart sidebar
        document.getElementById('sidebar-overlay').classList.remove('active');
        
        // Clear form
        document.getElementById('cust-name').value = '';
        document.getElementById('cust-phone').value = '';
        document.getElementById('cust-address').value = '';
        document.getElementById('instructions').value = '';
        
        // Show order confirmation
        setTimeout(() => {
            document.getElementById('orders-modal').classList.add('active');
            loadUserOrders();
        }, 1000);
        
    } catch (error) {
        console.error("Order error:", error);
        showToast("Error placing order: " + error.message, "error");
    }
};

// UI Handlers
document.getElementById('cart-btn').onclick = () => {
    document.getElementById('sidebar-overlay').classList.add('active');
    updateDeliveryInfo();
};

document.getElementById('close-cart').onclick = () => {
    document.getElementById('sidebar-overlay').classList.remove('active');
};

document.getElementById('my-orders-btn').onclick = () => {
    document.getElementById('orders-modal').classList.add('active');
    loadUserOrders();
};

document.getElementById('close-orders').onclick = () => {
    document.getElementById('orders-modal').classList.remove('active');
};

document.getElementById('close-modal').onclick = () => {
    document.getElementById('auth-modal').classList.remove('active');
};

document.getElementById('location-btn').onclick = () => {
    openLocationModal();
};

// Auth Form
document.getElementById('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-password').value.trim();
    const isLogin = document.getElementById('modal-title').innerText.includes("Login");
    
    if (!email || !pass) {
        showToast("Please fill all fields", "error");
        return;
    }
    
    const submitBtn = document.getElementById('auth-submit');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="loading"></span> Processing...';
    submitBtn.disabled = true;
    
    try {
        if (isLogin) {
            await signInWithEmailAndPassword(auth, email, pass);
            showToast("Welcome back!", "success");
        } else {
            await createUserWithEmailAndPassword(auth, email, pass);
            showToast("Account created successfully!", "success");
        }
        document.getElementById('auth-modal').classList.remove('active');
        document.getElementById('auth-form').reset();
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
};

// Toggle password visibility
document.getElementById('show-password').onclick = () => {
    const passwordInput = document.getElementById('auth-password');
    const eyeIcon = document.getElementById('show-password').querySelector('i');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeIcon.className = 'fas fa-eye-slash';
    } else {
        passwordInput.type = 'password';
        eyeIcon.className = 'fas fa-eye';
    }
};

// Switch between login/register
document.getElementById('switch-mode').onclick = () => {
    const title = document.getElementById('modal-title');
    const subtitle = document.getElementById('modal-subtitle');
    const submitBtn = document.getElementById('auth-submit');
    const submitText = submitBtn.querySelector('span');
    const switchMode = document.getElementById('switch-mode');
    const switchLink = switchMode.querySelector('.auth-link');
    
    if (title.innerText.includes("Login")) {
        title.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
        subtitle.textContent = "Register to start shopping";
        submitText.textContent = "Create Account";
        switchLink.textContent = "Already have an account? Login";
    } else {
        title.innerHTML = '<i class="fas fa-user-circle"></i> Welcome Back!';
        subtitle.textContent = "Login to your account to continue";
        submitText.textContent = "Login";
        switchLink.textContent = "New here? Create an account";
    }
};

// Toast notification function
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    
    setTimeout(() => {
        toast.className = toast.className.replace('show', '');
    }, 3000);
}

// Voice search
document.getElementById('voice-search').onclick = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            document.getElementById('product-search').value = transcript;
            searchTerm = transcript;
            renderProducts();
        };
        
        recognition.start();
        showToast("Listening... Speak now", "info");
    } else {
        showToast("Voice search not supported in your browser", "error");
    }
};

// Initialize cart UI on load
updateCartUI();
if (userLocation) {
    updateDeliveryInfo();
}