/**
 * ClousX - Username Generator Application
 * Refactored with modular architecture for maintainability
 */

'use strict';

/* ==============================================
   CONFIGURATION
   ============================================== */

const CONFIG = {
    API_URL: 'https://web-production-f8d35.up.railway.app/search',
    IP_API_URL: 'https://api.ipify.org?format=json',
    SEARCH_TIMEOUT_SEC: 30,
    RATE_LIMIT_MS: 30 * 60 * 1000, // 30 minutes
    TOAST_DURATION_MS: 3000,
    COPY_TOAST_DURATION_MS: 2000,
    FIREBASE_TIMEOUT_MS: 2000,
    ANIMATION_COOLDOWN_MS: 2000,
    FIREBASE_CONFIG: {
        apiKey: "AIzaSyB14Kk3sX8H0RSV50fB2t_WWrNH5xn7C7k",
        authDomain: "clousx.firebaseapp.com",
        databaseURL: "https://clousx-default-rtdb.firebaseio.com",
        projectId: "clousx",
        storageBucket: "clousx.firebasestorage.app",
        messagingSenderId: "784666965850",
        appId: "1:784666965850:web:aba5096d4bbc7531936563",
        measurementId: "G-LGFT2T7NVX"
    }

};

/* ==============================================
   APPLICATION STATE
   ============================================== */

const State = {
    currentUsername: null,
    hasRatedCurrent: false,
    userData: null,
    userId: null,
    countdownInterval: null,
    isAnimationCooldown: false,
    pulseObserver: null,
    pulseCleanupTimeout: null
};

/* ==============================================
   DOM CACHE
   ============================================== */

const DOM = {
    cache: {},

    get(id) {
        if (!this.cache[id]) {
            this.cache[id] = document.getElementById(id);
        }
        return this.cache[id];
    },

    query(selector) {
        return document.querySelector(selector);
    },

    queryAll(selector) {
        return document.querySelectorAll(selector);
    }
};

/* ==============================================
   UTILITY FUNCTIONS
   ============================================== */

const Utils = {
    getScrollbarWidth() {
        return window.innerWidth - document.documentElement.clientWidth;
    },

    preventDefault(e) {
        e.preventDefault();
    },

    formatTime(ms) {
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    },

    sanitizeIPForFirebase(ip) {
        return ip.replace(/\./g, '-');
    },

    generateUserId() {
        return 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    },

    formatNumber(num) {
        if (!num) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M+';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'k+';
        return num.toLocaleString('en-US');
    }
};

/* ==============================================
   SCROLL UTILITY (The Smart Lock)
   ============================================== */

const Scroll = {
    lock() {
        const scrollbarWidth = Utils.getScrollbarWidth();
        document.body.style.paddingRight = `${scrollbarWidth}px`;
        document.body.classList.add('no-scroll');

        // Block all scrolling events
        window.addEventListener('wheel', Utils.preventDefault, { passive: false });
        window.addEventListener('touchmove', Utils.preventDefault, { passive: false });

        // Stop Lenis
        if (window.lenis) window.lenis.stop();
    },

    unlock() {
        document.body.style.paddingRight = '';
        document.body.classList.remove('no-scroll');

        // Restore scrolling events
        window.removeEventListener('wheel', Utils.preventDefault, { passive: false });
        window.removeEventListener('touchmove', Utils.preventDefault, { passive: false });

        // Start Lenis
        if (window.lenis) window.lenis.start();
    }
};

/* ==============================================
   FINGERPRINT MODULE (Anti-Fraud)
   ============================================== */

const Fingerprint = {
    /**
     * Generate a unique Canvas Fingerprint hash.
     * This is nearly 100% unique per device based on GPU, fonts, and rendering.
     */
    generateCanvasHash() {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 200;
            canvas.height = 50;

            // Draw text with specific styling
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('ClousX-FP-2026', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('ClousX-FP-2026', 4, 17);

            // Get image data and hash it
            const dataUrl = canvas.toDataURL();
            return this.hashString(dataUrl);
        } catch (e) {
            console.warn('Canvas fingerprint failed:', e);
            return null;
        }
    },

    /**
     * Simple hash function (djb2 algorithm)
     */
    hashString(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    },

    /**
     * Generate full fingerprint object
     */
    generate() {
        return {
            canvasHash: this.generateCanvasHash(),
            userAgent: navigator.userAgent,
            language: navigator.language,
            platform: navigator.platform,
            screenSize: `${window.screen.width}x${window.screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    },

    /**
     * Check if two fingerprints match (same person)
     * Primary: Canvas hash (100% match = same device)
     * Fallback: 3+ matching fields = likely same person
     */
    match(stored, current) {
        // Primary check: Canvas hash is definitive
        if (stored.canvasHash && current.canvasHash && stored.canvasHash === current.canvasHash) {
            return true;
        }

        // Fallback: Count matching fields
        let matches = 0;
        const fields = ['userAgent', 'platform', 'screenSize', 'timezone', 'language'];

        for (const field of fields) {
            if (stored[field] && current[field] && stored[field] === current[field]) {
                matches++;
            }
        }

        // 3+ matches = likely same person
        return matches >= 3;
    },

    /**
     * Search Firebase for existing account with matching fingerprint
     * Returns the matching user data or null
     */
    async findExistingAccount(currentFingerprint) {
        if (!Firebase.db) return null;

        try {
            const usersRef = Firebase.db.ref('users');
            const snapshot = await usersRef.once('value');
            const users = snapshot.val();

            if (!users) return null;

            for (const [userId, userData] of Object.entries(users)) {
                // Skip if no fingerprint data
                if (!userData.canvasHash && !userData.userAgent) continue;

                // Check for match
                if (this.match(userData, currentFingerprint)) {
                    return { userId, userData };
                }
            }

            return null;
        } catch (error) {
            console.error('Error searching for existing account:', error);
            return null;
        }
    }
};

/* ==============================================
   FIREBASE MODULE
   ============================================== */

const Firebase = {
    db: null,
    ref: null,
    set: null,
    get: null,
    child: null,
    app: null,

    init() {
        try {
            if (typeof firebase === 'undefined') {
                console.error('Firebase SDK not loaded');
                return false;
            }

            this.app = firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
            firebase.analytics();
            this.db = firebase.database();

            this.ref = (db, path) => path ? db.ref(path) : db.ref();
            this.set = (ref, value) => ref.set(value);
            this.get = async (ref) => {
                const snapshot = await ref.once('value');
                return {
                    exists: () => snapshot.exists(),
                    val: () => snapshot.val()
                };
            };
            this.child = (ref, path) => ref.child(path);

            return true;
        } catch (error) {
            console.error('Firebase initialization failed:', error);
            return false;
        }
    },

    async getUserData(userId) {
        try {
            const ref = this.db.ref('users/' + userId);
            const snapshot = await ref.once('value');
            return snapshot.exists() ? snapshot.val() : null;
        } catch (error) {
            console.error('Error fetching user data:', error);
            return null;
        }
    },

    async setUserData(userId, data) {
        try {
            await this.db.ref('users/' + userId).set(data);
            return true;
        } catch (error) {
            console.error('Error saving user data:', error);
            return false;
        }
    },

    async updateUserData(userId, data) {
        try {
            await this.db.ref('users/' + userId).update(data);
            return true;
        } catch (error) {
            console.error('Error updating user data:', error);
            return false;
        }
    },

    async getIPRestriction(cleanIp) {
        try {
            const ref = this.db.ref('ip_restrictions/' + cleanIp);
            const snapshot = await ref.once('value');
            return snapshot.exists() ? snapshot.val() : null;
        } catch (error) {
            console.error('Error fetching IP restriction:', error);
            return null;
        }
    },

    async setIPRestriction(cleanIp, data) {
        try {
            await this.db.ref('ip_restrictions/' + cleanIp).set(data);
            return true;
        } catch (error) {
            console.error('Error saving IP restriction:', error);
            return false;
        }
    },

    async logRating(ratingData) {
        if (!this.db) return;
        try {
            const ratingsRef = this.db.ref('ratings');
            const newRatingRef = ratingsRef.push();
            await newRatingRef.set(ratingData);
        } catch (error) {
            console.error('Error logging rating:', error);
        }
    },

    async updateIPRestriction(cleanIp, data) {
        try {
            await this.db.ref('ip_restrictions/' + cleanIp).update(data);
            return true;
        } catch (error) {
            console.error('Error updating IP restriction:', error);
            return false;
        }
    },

    async deleteUser(userId) {
        try {
            await this.db.ref('users/' + userId).remove();
            return true;
        } catch (error) {
            console.error('Error deleting user:', error);
            return false;
        }
    },

    async deleteIPRestriction(cleanIp) {
        try {
            await this.db.ref('ip_restrictions/' + cleanIp).remove();
            return true;
        } catch (error) {
            console.error('Error deleting IP restriction:', error);
            return false;
        }
    },

    incrementStats(type) {
        if (!this.db) return;
        const ref = this.db.ref('stats/' + type);
        ref.transaction((currentValue) => {
            return (currentValue || 0) + 1;
        });
    },

    subscribeToStats(callback) {
        if (!this.db) return;
        const ref = this.db.ref('stats');
        ref.on('value', (snapshot) => {
            const val = snapshot.val();
            if (val) {
                callback(val);
            } else {
                // First run: Initialize stats if they don't exist
                this.initializeStats();
            }
        });
    },

    subscribeToUser(userId, callback) {
        if (!this.db || !userId) return;
        const ref = this.db.ref('users/' + userId);
        ref.on('value', (snapshot) => {
            const val = snapshot.val();
            callback(val);
        });
    },

    subscribeToIP(cleanIp, callback) {
        if (!this.db || !cleanIp) return;
        const ref = this.db.ref('ip_restrictions/' + cleanIp);
        ref.on('value', (snapshot) => {
            const val = snapshot.val();
            callback(val);
        });
    },

    initializeStats() {
        if (!this.db) return;
        this.db.ref('stats').set({
            generated: 0,
            users: 0
        }).catch(err => console.error('Stats init failed:', err));
    }
};

/* ==============================================
   NETWORK MODULE
   ============================================== */

const Network = {
    async getPublicIP() {
        try {
            const response = await fetch(CONFIG.IP_API_URL);
            if (!response.ok) return null;
            const data = await response.json();
            return {
                ip: data.ip,
                cleanIp: Utils.sanitizeIPForFirebase(data.ip)
            };
        } catch (error) {
            console.warn('IP check failed:', error);
            return null;
        }
    },

    async searchUsername() {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.SEARCH_TIMEOUT_SEC * 1000);

        try {
            const response = await fetch(CONFIG.API_URL, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
};

/* ==============================================
   UI MODULE
   ============================================== */

const UI = {
    showLoader() {
        const loader = DOM.get('globalLoader');
        if (loader) {
            loader.classList.remove('hidden');
            loader.style.visibility = 'visible';
            loader.style.display = '';
            document.body.classList.add('loading-active');
        }
    },

    hideLoader() {
        const loader = DOM.get('globalLoader');
        if (loader && !loader.classList.contains('hidden')) {
            loader.classList.add('hidden');
            document.body.classList.remove('loading-active');
            setTimeout(() => {
                loader.style.visibility = 'hidden';
                loader.style.display = 'none';
            }, 600);
        }
    },

    updateLoaderText(text) {
        const loaderText = DOM.query('.loader-text');
        if (loaderText) {
            loaderText.style.opacity = '0';
            setTimeout(() => {
                loaderText.textContent = text;
                loaderText.style.opacity = '1';
            }, 300);
        }
    },

    showTermsModal() {
        const modal = DOM.get('termsModal');
        if (modal) {
            Scroll.lock();
            modal.classList.add('active');
        }
    },

    hideTermsModal() {
        const modal = DOM.get('termsModal');
        if (modal) {
            modal.classList.remove('active');
            Scroll.unlock();

            setTimeout(() => {
                // Reset modal steps...
                const termsStep1 = DOM.get('termsStep1');
                const termsStep2 = DOM.get('termsStep2');
                const termsStep3 = DOM.get('termsStep3');
                const usernameInput = DOM.get('regUsername');
                const passwordInput = DOM.get('regPassword');

                if (termsStep1) {
                    termsStep1.style.display = 'block';
                    termsStep1.classList.remove('step-exit');
                }
                if (termsStep2) {
                    termsStep2.style.display = 'none';
                    termsStep2.classList.remove('step-enter', 'step-exit');
                }
                if (termsStep3) {
                    termsStep3.style.display = 'none';
                    termsStep3.classList.remove('step-enter');
                }

                // Reset Existing Account Step (Anti-Fraud)
                const termsStepExisting = DOM.get('termsStepExisting');
                if (termsStepExisting) {
                    termsStepExisting.style.display = 'none';
                    termsStepExisting.classList.remove('step-enter', 'step-exit');
                }

                // Reset Inputs & Buttons
                if (usernameInput) usernameInput.value = '';
                if (passwordInput) {
                    passwordInput.value = '';
                    passwordInput.setAttribute('type', 'password');
                }

                const nextToPasswordBtn = DOM.get('nextToPasswordBtn');
                const confirmTermsBtn = DOM.get('confirmTermsBtn');
                if (nextToPasswordBtn) nextToPasswordBtn.disabled = true;
                if (confirmTermsBtn) confirmTermsBtn.disabled = true;

                // Reset Password Icon
                const toggleIcon = DOM.get('togglePassword');
                if (toggleIcon) {
                    toggleIcon.classList.remove('fa-eye-slash');
                    toggleIcon.classList.add('fa-eye');
                }

                // Hide Progressive Fields (Legacy Cleanup)
                const passwordGroup = DOM.get('regPasswordGroup');
                const modalActionsRow = DOM.get('modalActionsRow');

                if (passwordGroup) passwordGroup.style.display = 'none';
                if (modalActionsRow) modalActionsRow.style.display = 'none';

                // Reset Checkbox
                if (termsCheck) termsCheck.checked = false;
            }, 300);
        }
    },

    showToast(toastId, duration = CONFIG.TOAST_DURATION_MS) {
        const toast = DOM.get(toastId);
        if (toast) {
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), duration);
        }
    },

    showValidationToast(message, errorId = null) {
        // Show inline error below input field
        if (errorId) {
            const errorEl = DOM.get(errorId);
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.add('show');

                // Auto-hide after 3 seconds
                setTimeout(() => {
                    errorEl.classList.remove('show');
                    errorEl.textContent = '';
                }, 3000);
                return;
            }
        }
        // Fallback: show native alert for errors without specific elements
        alert(message);
    },

    showCopyToast() {
        const copyToast = DOM.get('copyToast');
        if (copyToast) {
            copyToast.classList.add('show');
            setTimeout(() => copyToast.classList.remove('show'), CONFIG.COPY_TOAST_DURATION_MS);
        }
    },

    updateOutputValue(html, addClass = null, removeClass = null) {
        const outputValue = DOM.get('outputValue');
        if (outputValue) {
            outputValue.innerHTML = html;
            if (removeClass) outputValue.classList.remove(removeClass);
            if (addClass) outputValue.classList.add(addClass);
        }
    },

    updateStatusText(text) {
        const statusText = DOM.get('statusText');
        if (statusText) statusText.textContent = text;
    },

    updateStatusHTML(html) {
        const statusText = DOM.get('statusText');
        if (statusText) statusText.innerHTML = html;
    },

    unlockCard() {
        const searchCard = DOM.get('searchCard');
        const searchBtn = DOM.get('searchBtn');
        const statusText = DOM.get('statusText');
        const userAccountIcon = DOM.get('userAccountIcon');
        const registerHeaderBtn = DOM.get('registerHeaderBtn');
        const navbar = DOM.query('.navbar');
        const dropdownUsername = DOM.get('dropdownUsername');

        if (searchCard) searchCard.classList.remove('locked');
        if (searchBtn) searchBtn.disabled = false;
        if (statusText) statusText.textContent = 'سيتم البحث عن يوزرات شبه رباعية متاحة';

        // Update dropdown username
        if (dropdownUsername && State.userData && State.userData.username) {
            dropdownUsername.textContent = State.userData.username;
        }

        // Animated Login Sequence
        if (registerHeaderBtn && userAccountIcon) {
            // 1. Animate Register Out (Right)
            registerHeaderBtn.classList.add('animate-slide-out-right');

            setTimeout(() => {
                registerHeaderBtn.style.display = 'none';
                registerHeaderBtn.classList.remove('animate-slide-out-right');

                if (navbar) navbar.classList.add('registered-nav');

                // 2. Animate Icon In (From Right)
                userAccountIcon.style.display = 'flex';
                userAccountIcon.classList.add('animate-slide-in-start');

                // Force Reflow
                void userAccountIcon.offsetWidth;

                userAccountIcon.classList.add('animate-slide-in-end');

                setTimeout(() => {
                    userAccountIcon.classList.remove('animate-slide-in-start', 'animate-slide-in-end');
                }, 500);
            }, 400);
        } else {
            // Fallback (Direct Swap)
            if (registerHeaderBtn) registerHeaderBtn.style.display = 'none';
            if (userAccountIcon) userAccountIcon.style.display = 'flex';
            if (navbar) navbar.classList.add('registered-nav');
        }

        // Ensure disabled if unlocking fresh (no username yet)
        const outputValue = DOM.get('outputValue');
        const ratingLabel = DOM.query('.rating-label');
        if (outputValue && outputValue.innerText.includes('اضغط للبدء') && ratingLabel) {
            ratingLabel.classList.add('disabled');
        }
    },

    lockCard() {
        const searchCard = DOM.get('searchCard');
        const searchBtn = DOM.get('searchBtn');
        const statusText = DOM.get('statusText');
        const userAccountIcon = DOM.get('userAccountIcon');
        const registerHeaderBtn = DOM.get('registerHeaderBtn');
        const navbar = DOM.query('.navbar');
        const outputValue = DOM.get('outputValue');
        const ratingLabel = DOM.query('.rating-label'); // Get label

        if (searchCard) searchCard.classList.add('locked');
        if (searchBtn) searchBtn.disabled = true;
        if (statusText) statusText.textContent = 'سجل أولاً للبحث عن يوزرات';

        if (registerHeaderBtn) registerHeaderBtn.style.display = 'block';
        if (userAccountIcon) userAccountIcon.style.display = 'none'; // Hide Icon

        if (navbar) navbar.classList.remove('registered-nav');
        if (outputValue) {
            outputValue.innerHTML = 'اضغط للبدء';
            outputValue.classList.remove('found');
        }

        // Disable rating label
        if (ratingLabel) ratingLabel.classList.add('disabled');
    },

    displayUsername(username) {
        const outputValue = DOM.get('outputValue');
        const ratingLabel = DOM.query('.rating-label'); // Get label

        if (outputValue) {
            outputValue.innerHTML = `<span class="at-symbol">@</span><span class="user-id">${username}</span>`;
            outputValue.classList.add('found');
        }

        // Enable rating label (Check persistence)
        const lastRated = localStorage.getItem('clousx_last_rated_user');

        if (ratingLabel) {
            if (lastRated === username) {
                ratingLabel.classList.add('disabled');
                State.hasRatedCurrent = true;
            } else {
                ratingLabel.classList.remove('disabled');
                State.hasRatedCurrent = false;
            }
        }

        State.currentUsername = username; // Save for rating
    },

    updateStats(generated, users) {
        this.animateTicker('statGenerated', generated);
        this.animateTicker('statUsers', users);
    },

    animateTicker(elementId, newValueRaw) {
        const el = DOM.get(elementId);
        if (!el || newValueRaw === undefined) return;

        const newValue = Utils.formatNumber(newValueRaw);

        // Initial Render or Full Reset (if empty or no children yet)
        if (!el.children.length || !el.querySelector('.d-cont')) {
            this.renderFullNumber(el, newValue);
            return;
        }

        let currentDigits = Array.from(el.children);
        let currentStr = currentDigits.map(c => c.dataset.val).join('');

        // Handle length mismatch (e.g. 99 -> 100) by padding with '0' or empty space
        if (currentStr.length < newValue.length) {
            const diff = newValue.length - currentStr.length;
            for (let i = 0; i < diff; i++) {
                const dCont = document.createElement('span');
                dCont.className = 'd-cont';
                dCont.dataset.val = '0'; // Assume 0 pre-growth
                dCont.innerHTML = `<span class="d-val">0</span>`;
                el.insertBefore(dCont, el.firstChild);
            }
            // Refetch after padding
            currentDigits = Array.from(el.children);
            currentStr = currentDigits.map(c => c.dataset.val).join('');
        }

        // Handle Shrink case (e.g. 999.9k+ -> 1.0M+)
        // Pad newValue with spaces so it matches current length, then snap after anim
        let targetAnimStr = newValue;
        let needsCleanup = false;

        if (currentStr.length > newValue.length) {
            const diff = currentStr.length - newValue.length;
            targetAnimStr = ' '.repeat(diff) + newValue;
            needsCleanup = true;
        }

        // Per-Digit Update
        for (let i = 0; i < targetAnimStr.length; i++) {
            const newChar = targetAnimStr[i];
            const oldChar = currentStr[i];

            if (newChar !== oldChar) {
                // If we are shrinking, currentDigits[i] exists because we padded target to match current
                if (currentDigits[i]) {
                    this.animateDigit(currentDigits[i], oldChar, newChar);
                }
            }
        }

        if (needsCleanup) {
            setTimeout(() => {
                this.renderFullNumber(el, newValue);
            }, 600); // Slightly longer than anim duration to effectively snap
        }
    },

    renderFullNumber(el, numStr) {
        el.innerHTML = '';
        for (let char of numStr) {
            const dCont = document.createElement('span');
            dCont.className = 'd-cont';
            dCont.dataset.val = char;
            dCont.innerHTML = `<span class="d-val">${char}</span>`;
            el.appendChild(dCont);
        }
    },

    animateDigit(container, oldChar, newChar) {
        // Update dataset imediatelly so next checks are correct
        container.dataset.val = newChar;

        container.innerHTML = `<div class="d-slider"><span class="d-val">${oldChar}</span><span class="d-val">${newChar}</span></div>`;

        const slider = container.querySelector('.d-slider');

        if (slider) {
            // Force Reflow
            void slider.offsetWidth;

            // Animate
            slider.style.transform = 'translateY(-1.2em)';

            // Add Color Effect
            container.classList.add('updating');

            // Cleanup
            setTimeout(() => {
                container.innerHTML = `<span class="d-val">${newChar}</span>`;
                container.classList.remove('updating');
            }, 500);
        }
    },

    showToast(toastId, duration = CONFIG.TOAST_DURATION_MS) {
        const toast = DOM.get(toastId);
        if (toast) {
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), duration);
        }
    },

    showRatingModal(username) {
        const modal = DOM.get('ratingModal');
        const usernameEl = DOM.get('ratingUsername');
        const starsContainer = DOM.get('ratingStars');
        const successMsg = DOM.get('ratingSuccess');

        if (modal && usernameEl) {
            Scroll.lock();

            // Inject styled username
            usernameEl.innerHTML = `<span class="at-symbol">@</span>${username}`;
            modal.classList.add('active');

            // Reset State for Transition
            const ratingContent = DOM.get('ratingContent');
            if (ratingContent) {
                ratingContent.style.display = 'block';
                ratingContent.classList.remove('fade-out');
                ratingContent.style.opacity = '1';
                ratingContent.style.transform = 'scale(1)';
            }

            // Reset Stars
            const starsContainer = DOM.get('ratingStars');
            if (starsContainer) {
                starsContainer.querySelectorAll('.star').forEach(star => {
                    star.classList.remove('filled', 'flicker', 'hover-filled');
                    star.style.opacity = '1';
                });
            }

            // Reset Success Msg
            const successMsg = DOM.get('ratingSuccess');
            if (successMsg) {
                successMsg.style.display = 'none';
                successMsg.classList.remove('active');
            }
        }
    },

    hideRatingModal() {
        const modal = DOM.get('ratingModal');
        if (modal) {
            modal.classList.remove('active');
            Scroll.unlock();
        }
    },

    handleRating(rating) {
        const stars = DOM.queryAll('#ratingStars .star');
        const starsContainer = DOM.get('ratingStars');
        const successMsg = DOM.get('ratingSuccess');
        const ratingTitle = DOM.query('.rating-title');
        const ratingUsername = DOM.get('ratingUsername');

        // 1. Fill selected stars
        stars.forEach(star => {
            const val = parseInt(star.dataset.value);
            if (val <= rating) {
                star.classList.add('filled');
            } else {
                // 2. Flicker unselected stars
                star.classList.add('flicker');
            }
        });

        // 3. Wait brief moment then hide elements
        // 3. Wait brief moment then hide elements
        setTimeout(() => {
            const ratingContent = DOM.get('ratingContent');

            if (ratingContent) {
                ratingContent.classList.add('fade-out');

                // Wait for fade out, then switch
                setTimeout(() => {
                    ratingContent.style.display = 'none';

                    if (successMsg) {
                        successMsg.style.display = 'flex';
                        // Force reflow
                        void successMsg.offsetWidth;
                        successMsg.classList.add('active');
                    }
                }, 300); // Matches CSS transition
            } else {
                // Fallback if wrapper missing
                if (starsContainer) starsContainer.style.display = 'none';
                if (ratingTitle) ratingTitle.style.display = 'none';
                if (ratingUsername) ratingUsername.style.display = 'none';
                if (successMsg) successMsg.style.display = 'flex';
            }

            // 5. Save validity and close
            // 5. Save validity and close
            const raterName = (State.userData && State.userData.username) ? State.userData.username : 'مستخدم';

            const ratingData = {
                username: State.currentUsername,
                rating: rating,
                raterId: State.userId || 'anonymous',
                raterName: raterName,
                timestamp: Date.now()
            };

            Firebase.logRating(ratingData);

            // Disable the rating button for this session/user
            const ratingLabel = DOM.query('.rating-label');
            if (ratingLabel) {
                ratingLabel.classList.add('disabled');
                State.hasRatedCurrent = true;

                // Persist rated state for this username
                if (State.currentUsername) {
                    localStorage.setItem('clousx_last_rated_user', State.currentUsername);
                }
            }

            // Close after delay
            setTimeout(() => {
                UI.hideRatingModal();
            }, 2500); // Allow time to read success message

        }, 400); // Initial delay before fade out starts
    },


    highlightSearchCard() {
        const searchCard = DOM.get('searchCard');

        // Scroll to Card (Center in Viewport)
        if (searchCard) {
            if (window.lenis) {
                // Lenis: Calculate offset to center the element
                const offset = -1 * (window.innerHeight - searchCard.offsetHeight) / 2;
                window.lenis.scrollTo(searchCard, { offset: offset });
            } else {
                // Native: Use scrollIntoView with block center
                searchCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } else {
            // Fallback
            if (window.lenis) window.lenis.scrollTo(0);
            else window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Pulse Animation (With Cooldown for performance)
        if (!State.isAnimationCooldown) {
            State.isAnimationCooldown = true;
            setTimeout(() => { State.isAnimationCooldown = false; }, CONFIG.ANIMATION_COOLDOWN_MS);

            const pulseWrapper = DOM.get('pulseWrapper');
            const searchCard = DOM.get('searchCard');

            if (pulseWrapper && searchCard) {
                // Clear any existing cleanup timeout to prevent abrupt cutoff
                if (State.pulseCleanupTimeout) {
                    clearTimeout(State.pulseCleanupTimeout);
                }

                if (searchCard.classList.contains('locked')) {
                    pulseWrapper.classList.add('pulse-locked');
                } else {
                    pulseWrapper.classList.remove('pulse-locked');
                }

                pulseWrapper.classList.remove('highlight-pulse');
                void pulseWrapper.offsetWidth; // Force Reflow
                pulseWrapper.classList.add('highlight-pulse');

                State.pulseCleanupTimeout = setTimeout(() => {
                    pulseWrapper.classList.remove('highlight-pulse', 'pulse-locked');
                    State.pulseCleanupTimeout = null;
                }, 2000);
            }
        }
    },

    injectSVGBorders() {
        const wrappers = DOM.queryAll('.input-wrapper');
        wrappers.forEach(wrapper => {
            // Check if already injected
            if (wrapper.querySelector('.border-svg')) return;

            // Create SVG
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("class", "border-svg");
            svg.style.position = "absolute";
            svg.style.top = "0";
            svg.style.left = "0";
            svg.style.width = "100%";
            svg.style.height = "100%";
            svg.style.pointerEvents = "none";
            svg.style.zIndex = "10";
            svg.style.overflow = "visible";

            // Create Path (instead of Rect for custom start point)
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", "#59e060"); // Primary Green
            path.setAttribute("stroke-width", "1.5");
            path.setAttribute("pathLength", "100"); // Standardize length for CSS
            path.setAttribute("stroke-dasharray", "100");
            path.setAttribute("stroke-dashoffset", "100"); // Start hidden
            path.setAttribute("stroke-linecap", "round");

            svg.appendChild(path);
            wrapper.appendChild(svg);

            // Function to update path D attribute
            const updatePath = () => {
                const w = wrapper.offsetWidth;
                const h = wrapper.offsetHeight;
                const r = 12; // Border Radius match

                // Start from Top Center -> Clockwise
                const d = `
                    M ${w / 2} 0
                    L ${w - r} 0
                    Q ${w} 0 ${w} ${r}
                    L ${w} ${h - r}
                    Q ${w} ${h} ${w - r} ${h}
                    L ${r} ${h}
                    Q 0 ${h} 0 ${h - r}
                    L 0 ${r}
                    Q 0 0 ${r} 0
                    L ${w / 2} 0
                `;
                path.setAttribute("d", d);
            };

            // Initial Draw
            updatePath();

            // Observe Resize
            const ro = new ResizeObserver(updatePath);
            ro.observe(wrapper);
        });
    },

    /* ==============================================
       REVIEWS MODULE
       ============================================== */

    initReviews() {
        const reviewsGrid = DOM.get('reviewsGrid');
        if (!reviewsGrid) return;

        // Check firebase availability
        if (typeof firebase === 'undefined') return;

        const ratingsRef = firebase.database().ref('ratings');

        // Listen for last 4 ratings
        ratingsRef.orderByChild('timestamp').limitToLast(4).on('value', (snapshot) => {
            const reviews = [];
            snapshot.forEach((child) => {
                reviews.push(child.val());
            });

            // Firebase returns ascending, we want descending (newest first)
            reviews.reverse();

            this.renderReviews(reviews);
        });
    },

    renderReviews(reviews) {
        const grid = DOM.get('reviewsGrid');
        if (!grid) return;

        grid.innerHTML = '';
        grid.className = 'reviews-grid'; // Reset classes

        if (reviews.length === 0) {
            grid.innerHTML = `
                <div class="no-reviews">
                    <div class="no-reviews-icon"><i class="fa-regular fa-comments"></i></div>
                    <p class="no-reviews-text">لم يتم إضافة تقييمات بعد.. كن أول المبادرين!</p>
                </div>
            `;
            return;
        }

        // Apply Layout Class
        if (reviews.length >= 4) grid.classList.add('layout-4');
        else if (reviews.length === 3) grid.classList.add('layout-3');
        else if (reviews.length === 2) grid.classList.add('layout-2');
        else grid.classList.add('layout-1');

        reviews.forEach(review => {
            const timeStr = this.formatTime(review.timestamp);
            const starsHtml = Array(5).fill(0).map((_, i) =>
                `<i class="fa-solid fa-star ${i < review.rating ? '' : 'empty'}" style="${i < review.rating ? '' : 'color: #444;'}"></i>`
            ).join('');

            // Generate deterministic avatar color/letter (kept for color if needed, but using Icon now)
            // const initial = (review.raterId || 'U').substring(0, 1).toUpperCase();

            const card = document.createElement('article');
            card.className = 'review-card';
            card.style.animation = 'fadeIn 0.5s ease backwards';
            card.innerHTML = `
                <div class="review-avatar"><i class="fa-solid fa-user"></i></div>
                <div class="review-content">
                    <div class="review-header">
                        <span class="review-author">${review.raterName || 'مستخدم'}</span>
                        <span class="review-time">${timeStr}</span>
                    </div>
                    <div class="review-target">
                        قيم <span class="at">@</span>${review.username}
                    </div>
                    <div class="review-stars">
                        ${starsHtml}
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    },

    formatTime(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);

        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " سنة";

        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " شهر";

        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " يوم";

        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " ساعة";

        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " دقيقة";

        return "الآن";
    }
};

/* ==============================================
   PROGRESS BAR MODULE
   ============================================== */

const ProgressBar = {
    container: null,
    bar: null,
    text: null,
    time: null,
    timerInterval: null,

    init() {
        this.container = DOM.get('searchProgressContainer');
        this.bar = DOM.get('searchProgressBar');
        this.text = DOM.get('searchProgressText');
        this.time = DOM.get('searchProgressTime');
    },

    show() {
        if (!this.container) this.init();
        if (!this.container) return;

        this.bar.style.width = '0%';
        if (this.text) this.text.innerText = '0%';
        if (this.time) this.time.innerText = `${CONFIG.SEARCH_TIMEOUT_SEC}s`;

        this.container.style.visibility = 'visible';
        this.container.classList.add('visible');
        void this.container.offsetWidth; // Force reflow
        this.container.classList.add('active');
    },

    update(percent, remaining) {
        if (this.bar) this.bar.style.width = `${percent}%`;
        if (this.text) this.text.innerText = `${Math.round(percent)}%`;
        if (this.time) this.time.innerText = `${remaining}s`;
    },

    hide(isSuccess) {
        if (!this.container) return;

        if (isSuccess) {
            this.bar.style.width = '100%';
            if (this.text) this.text.innerText = '100%';
            if (this.time) this.time.innerText = 'تم!';
        } else {
            if (this.time) this.time.innerText = 'خطأ';
        }

        const hideDelay = isSuccess ? 600 : 100;

        setTimeout(() => {
            this.container.classList.remove('active');
            setTimeout(() => {
                this.container.classList.remove('visible');
                this.bar.style.width = '0%';
                if (this.text) this.text.innerText = '0%';
            }, 800);
        }, hideDelay);
    },

    startTimer(onTick) {
        let elapsed = 0;

        this.timerInterval = setInterval(() => {
            elapsed++;
            const percent = Math.min((elapsed / CONFIG.SEARCH_TIMEOUT_SEC) * 100, 100);
            const remaining = Math.max(CONFIG.SEARCH_TIMEOUT_SEC - elapsed, 0);

            this.update(percent, remaining);
            if (onTick) onTick(elapsed);
        }, 1000);

        return this.timerInterval;
    },

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
};

/* ==============================================
   SEARCH MODULE
   ============================================== */

const Search = {
    async start() {
        const searchBtn = DOM.get('searchBtn');
        const statusText = DOM.get('statusText');

        // Local rate limit check
        if (State.userData?.lastUsage) {
            const timePassed = Date.now() - State.userData.lastUsage;
            if (timePassed < CONFIG.RATE_LIMIT_MS) {
                Auth.startCountdown(CONFIG.RATE_LIMIT_MS - timePassed);
                return;
            }
        }

        if (searchBtn) {
            searchBtn.disabled = true;
            statusText.textContent = 'التحقق من البيانات...';
        }

        // Verify user still exists in Firebase
        if (State.userId && Firebase.db) {
            try {
                const userData = await Firebase.getUserData(State.userId);
                if (!userData) {
                    localStorage.removeItem('clousx_is_registered');
                    UI.lockCard();
                    return;
                }
            } catch (error) {
                console.error('Verification error:', error);
            }
        }

        // IP rate limit check
        const ipInfo = await Network.getPublicIP();
        if (ipInfo && Firebase.db) {
            try {
                const ipData = await Firebase.getIPRestriction(ipInfo.cleanIp);
                if (ipData) {
                    const ipTimePassed = Date.now() - (ipData.lastUsage || 0);
                    if (ipTimePassed < CONFIG.RATE_LIMIT_MS) {
                        Auth.startCountdown(CONFIG.RATE_LIMIT_MS - ipTimePassed);
                        return;
                    }
                }
            } catch (error) {
                console.error('IP check error:', error);
            }
        }

        State.currentUsername = null;

        await this.performSearch();

        // Lock after successful search
        if (State.currentUsername) {
            const now = Date.now();

            if (State.userId && Firebase.db) {
                try {
                    await Firebase.updateUserData(State.userId, {
                        lastUsage: now,
                        lastUsername: State.currentUsername
                    });

                    State.userData = State.userData || {};
                    State.userData.lastUsage = now;
                    State.userData.lastUsername = State.currentUsername;
                    localStorage.setItem('lastGeneratedUser', State.currentUsername);
                } catch (error) {
                    console.error('Failed to update User DB:', error);
                }
            }

            if (ipInfo && Firebase.db) {
                try {
                    await Firebase.updateIPRestriction(ipInfo.cleanIp, {
                        lastUsage: now,
                        lastUsername: State.currentUsername
                    });
                } catch (error) {
                    console.error('Failed to update IP DB:', error);
                }
            }

            Auth.startCountdown(CONFIG.RATE_LIMIT_MS);
        } else {
            if (searchBtn) searchBtn.disabled = false;
        }
    },

    async performSearch() {
        const searchBtn = DOM.get('searchBtn');
        const outputValue = DOM.get('outputValue');
        const statusText = DOM.get('statusText');

        if (searchBtn) {
            searchBtn.disabled = true;
            searchBtn.classList.add('loading');
        }

        UI.updateOutputValue(`
            <div class="spinner-container">
                <div class="modern-dot-spinner"></div>
                <div class="modern-dot-spinner"></div>
                <div class="modern-dot-spinner"></div>
            </div>
        `, 'searching', 'found');

        ProgressBar.show();

        const timerInterval = ProgressBar.startTimer((elapsed) => {
            if (elapsed < 5) statusText.innerText = "جاري البحث...";
            else if (elapsed < 12) statusText.innerText = "فحص قاعدة البيانات...";
            else if (elapsed < 20) statusText.innerText = "انتظار الرد من الخادم...";
            else if (elapsed < 28) statusText.innerText = "التحقق من التوفر...";
            else statusText.innerText = "معالجة النتيجة...";
        });

        try {
            const data = await Network.searchUsername();

            ProgressBar.stopTimer();
            if (searchBtn) searchBtn.classList.remove('loading');
            if (outputValue) outputValue.classList.remove('searching');
            ProgressBar.hide(true);

            if (data.status === 'success' && data.username) {
                UI.displayUsername(data.username);
                UI.updateStatusText('اضغط على اليوزر لنسخه');
                State.currentUsername = data.username;
                Firebase.incrementStats('generated'); // Increment Generated Count
            } else {
                UI.updateOutputValue('لم يتم العثور');
                UI.updateStatusText('حاول مرة أخرى لاحقاً');
            }
        } catch (error) {
            ProgressBar.stopTimer();
            if (searchBtn) searchBtn.classList.remove('loading');
            if (outputValue) outputValue.classList.remove('searching');
            ProgressBar.hide(false);

            if (error.name === 'AbortError') {
                UI.updateOutputValue('انتهى الوقت');
                UI.updateStatusText('السيرفر استغرق وقتاً طويلاً، حاول مجدداً');
            } else {
                UI.updateOutputValue('حدث خطأ');
                UI.updateStatusText('تحقق من الاتصال وحاول لاحقاً');
            }
        }
    }
};

/* ==============================================
   AUTH MODULE
   ============================================== */

const Auth = {
    getPersistentUserId() {
        let id = localStorage.getItem('clousx_user_id');
        if (!id) {
            id = Utils.generateUserId();
            localStorage.setItem('clousx_user_id', id);
        }
        return id;
    },

    async register() {
        const usernameInput = DOM.get('regUsername');
        const passwordInput = DOM.get('regPassword');
        // Terms Check is now implicit in Step 1 "Agree" button

        if (!usernameInput || !passwordInput) return;

        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username || username.length < 3) {
            UI.showValidationToast('3 أحرف على الأقل', 'usernameError');
            return;
        }

        if (!password || password.length < 6) {
            UI.showValidationToast('6 أحرف على الأقل', 'passwordError');
            return;
        }

        UI.hideTermsModal();

        const browserInfo = {
            username: username,
            password: password, // Note: Storing as plain text per user request (Client-side usage)
            canvasHash: Fingerprint.generateCanvasHash(), // Anti-fraud fingerprint
            userAgent: navigator.userAgent,
            language: navigator.language,
            platform: navigator.platform,
            screenSize: `${window.screen.width}x${window.screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            registeredAt: Date.now()
        };

        // CRITICAL: Database & LocalStorage
        try {
            await Firebase.setUserData(State.userId, browserInfo);
            localStorage.setItem('clousx_is_registered', 'true');
            State.userData = browserInfo;

            UI.unlockCard();
        } catch (error) {
            console.error('Registration Critical Error:', error);
            UI.showValidationToast('فشل التسجيل، يرجى المحاولة مرة أخرى');
            return;
        }

        // NON-CRITICAL: UI Enhancements & Stats
        try {
            // UI.showToast('regToast'); // Removed per user request
            UI.highlightSearchCard(); // Pulse animation and scroll
            Firebase.incrementStats('users'); // Increment User Count
        } catch (uiError) {
            console.warn('Registration UI Error (Ignored):', uiError);
            // Do not alert the user, registration was successful
        }
    },

    startCountdown(remainingMs) {
        const searchBtn = DOM.get('searchBtn');
        if (searchBtn) searchBtn.disabled = true;

        if (State.countdownInterval) {
            clearInterval(State.countdownInterval);
        }

        const endTime = Date.now() + remainingMs;

        const update = () => {
            const timeLeft = endTime - Date.now();

            // 1. Trigger Preparation Shake (2s before end)
            if (timeLeft <= 2100 && timeLeft > 1800) {
                const card = DOM.get('searchCard');
                if (card && !card.classList.contains('preparing')) {
                    card.classList.add('preparing');
                }
            }

            if (timeLeft <= 0) {
                clearInterval(State.countdownInterval);

                const card = DOM.get('searchCard');
                const searchBtn = DOM.get('searchBtn'); // Get btn ref

                if (card) {
                    card.classList.remove('preparing');
                    card.classList.add('reactivate'); // Trigger Flash at 0s
                }

                // 2. Perform Visual Reset IMMEDIATE (at 100ms, start of flash)
                setTimeout(() => {
                    this.resetUserData(); // Changes text to "Click to Start" invisibly
                    if (searchBtn) searchBtn.disabled = false; // Turn Green immediately under flash
                    UI.updateStatusText('سيتم البحث عن يوزرات شبه رباعية متاحة');
                }, 100);
                // 3. Cleanup at END (0.8s)
                setTimeout(() => {
                    // Cleanup classes after animation is fully done
                    if (card) {
                        card.classList.remove('reactivate');
                    }
                }, 800);

                return;
            }

            UI.updateStatusHTML(`
                <div class="cooldown-simple">
                    <span>متاح مجدداً خلال:</span>
                    <strong>${Utils.formatTime(timeLeft)}</strong>
                </div>
            `);
        };

        update();
        State.countdownInterval = setInterval(update, 1000);
    },

    async resetUserData() {
        const outputValue = DOM.get('outputValue');
        const searchCard = DOM.get('searchCard');

        if (outputValue) {
            outputValue.innerHTML = 'اضغط للبدء';
            outputValue.classList.remove('found');

            // Disable rating label
            const ratingLabel = DOM.query('.rating-label');
            if (ratingLabel) ratingLabel.classList.add('disabled');
        }

        // Removed pulse-finish since we have the new white flash animation
        // if (searchCard) {
        //     searchCard.classList.add('pulse-finish');
        //     searchCard.classList.remove('reactivate'); // Clean up
        //     setTimeout(() => searchCard.classList.remove('pulse-finish'), 1500);
        // }

        localStorage.removeItem('lastGeneratedUser');
        State.currentUsername = null;

        if (State.userData) {
            State.userData.lastUsage = 0;
            State.userData.lastUsername = null;
        }

        if (State.userId && Firebase.db) {
            try {
                // Use update with null to delete specific fields without deleting the user
                await Firebase.updateUserData(State.userId, {
                    lastUsername: null,
                    lastUsage: null
                });

                const ipInfo = await Network.getPublicIP();
                if (ipInfo) {
                    await Firebase.updateIPRestriction(ipInfo.cleanIp, {
                        lastUsername: null,
                        lastUsage: null
                    });
                }
            } catch (error) {
                console.error('Reset DB Error:', error);
            }
        }
    },

    checkRateLimit(userData) {
        const lastUsage = userData.lastUsage || 0;
        const timePassed = Date.now() - lastUsage;

        if (lastUsage && timePassed < CONFIG.RATE_LIMIT_MS) {
            this.startCountdown(CONFIG.RATE_LIMIT_MS - timePassed);
        }
    },

    async checkUserStatus() {
        try {
            UI.updateLoaderText("جاري المزامنة مع السحاب...");

            const [userData, ipInfo] = await Promise.all([
                Firebase.getUserData(State.userId).catch(err => {
                    console.warn('Firebase user fetch failed:', err);
                    return null;
                }),
                Network.getPublicIP().catch(err => {
                    console.warn('IP fetch failed:', err);
                    return null;
                })
            ]);

            UI.updateLoaderText("جاري فحص القيود...");

            let isBlockedByIP = false;

            if (ipInfo) {
                try {
                    const ipData = await Firebase.getIPRestriction(ipInfo.cleanIp);
                    if (ipData) {
                        const timePassed = Date.now() - (ipData.lastUsage || 0);
                        if (timePassed < CONFIG.RATE_LIMIT_MS) {
                            isBlockedByIP = true;

                            // CRITICAL FIX: Do NOT unlock card just because IP is blocked.
                            // Only show the countdown and last username. 
                            // Access to search button remains restricted until login.

                            // CRITICAL FIX: Only show countdown/username if registered locally.
                            // If not registered (logged out), keep card clean/locked.
                            const isRegistered = localStorage.getItem('clousx_is_registered') === 'true';

                            if (isRegistered) {
                                this.startCountdown(CONFIG.RATE_LIMIT_MS - timePassed);

                                if (ipData.lastUsername) {
                                    UI.displayUsername(ipData.lastUsername);
                                    State.currentUsername = ipData.lastUsername;
                                    localStorage.setItem('lastGeneratedUser', ipData.lastUsername);
                                }
                                UI.unlockCard();
                            } else {
                                // If logged out, do NOTHING. 
                                // Keep UI locked and clean (default state "اضغط للبدء").
                                // The blockage will be re-checked when they try to register/login.
                                UI.lockCard();
                            }
                        }
                    }
                } catch (ipErr) {
                    console.warn('IP Restriction check failed:', ipErr);
                }
            }

            if (!isBlockedByIP) {
                if (userData) {
                    UI.updateLoaderText("تم تأكيد الحساب.");
                    State.userData = userData;

                    localStorage.setItem('clousx_is_registered', 'true');

                    UI.unlockCard();
                    this.checkRateLimit(userData);

                    if (userData.lastUsername) {
                        UI.displayUsername(userData.lastUsername);
                        State.currentUsername = userData.lastUsername;
                        localStorage.setItem('lastGeneratedUser', userData.lastUsername);
                    }
                } else {
                    localStorage.removeItem('clousx_is_registered');
                    localStorage.removeItem('lastGeneratedUser');
                    UI.lockCard();
                }
            }
        } catch (error) {
            console.error('Critical Sync Error:', error);

            const isRegisteredLocal = localStorage.getItem('clousx_is_registered') === 'true';
            if (isRegisteredLocal) {
                UI.unlockCard();
                const lastUserLocal = localStorage.getItem('lastGeneratedUser');
                if (lastUserLocal) {
                    UI.displayUsername(lastUserLocal);
                    State.currentUsername = lastUserLocal;
                }
            } else {
                UI.lockCard();
            }
        }
    },

    // Logout: Clear session and reset UI with Animation
    logout() {
        // 1. Close Dropdown (if open)
        const userDropdown = DOM.get('userDropdown');
        if (userDropdown) userDropdown.classList.remove('open');

        // Clear data immediately
        localStorage.removeItem('clousx_is_registered');
        localStorage.removeItem('lastGeneratedUser');
        localStorage.removeItem('clousx_user_id');

        // Reset state
        State.userId = null;
        State.currentUsername = null;

        // Clear countdown
        if (State.countdownInterval) {
            clearInterval(State.countdownInterval);
            State.countdownInterval = null;
        }

        // UI References
        const navbar = DOM.query('.navbar');
        const registerBtn = DOM.get('registerHeaderBtn');
        const userIcon = DOM.get('userAccountIcon');

        // WAIT 100ms (minimal delay for immediate feel) before starting icon animation
        setTimeout(() => {
            // 2. Animate User Icon Out (Slide RIGHT & Fade)
            if (userIcon) {
                userIcon.classList.add('animate-slide-out-right');
            }

            // Sync with CSS 0.4s exit transition (400ms)
            setTimeout(() => {
                // 3. Swap Elements (Hide Icon, Show Register Btn)
                if (userIcon) {
                    userIcon.style.display = 'none';
                    userIcon.classList.remove('animate-slide-out-right'); // Reset class
                }

                if (navbar) navbar.classList.remove('registered-nav');

                if (registerBtn) {
                    registerBtn.style.display = 'inline-flex';
                    registerBtn.classList.add('animate-slide-in-start');

                    // Force Reflow
                    void registerBtn.offsetWidth;

                    // 4. Animate Register Btn In
                    registerBtn.classList.add('animate-slide-in-end');

                    // Cleanup classes after animation (500ms)
                    setTimeout(() => {
                        registerBtn.classList.remove('animate-slide-in-start', 'animate-slide-in-end');
                    }, 500);
                }

                // Reset Main UI Card
                UI.lockCard();
                UI.updateStatusText('سجل أولاً للبحث عن يوزرات');
                UI.updateOutputValue('اضغط للبدء', null, 'found');

            }, 400);
        }, 100); // Near-instant start for better responsiveness
    }
};

/* ==============================================
   CLIPBOARD MODULE
   ============================================== */

const Clipboard = {
    async copyUsername() {
        const username = State.currentUsername || localStorage.getItem('lastGeneratedUser');
        if (username) {
            try {
                await navigator.clipboard.writeText(username);
                UI.showCopyToast();
            } catch (error) {
                console.error('Copy failed:', error);
            }
        }
    }
};

/* ==============================================
   SCROLL ANIMATION MODULE
   ============================================== */

const ScrollAnimation = {
    revealObserver: null,
    navObserver: null,

    init() {
        this.initRevealAnimations();
        this.initNavHighlighting();
        this.initNavbarScroll();
    },

    initRevealAnimations() {
        const observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };

        this.revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('show');
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        const hiddenElements = DOM.queryAll('.hero-content, .hero-grid, .feature-card, .about-content, .stat-item');
        hiddenElements.forEach(el => {
            el.classList.add('hidden');
            this.revealObserver.observe(el);
        });
    },

    initNavHighlighting() {
        const sections = DOM.queryAll('section');
        const navLinks = DOM.queryAll('.nav-links a');

        this.navObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    navLinks.forEach(link => {
                        link.classList.remove('active');
                        if (link.getAttribute('href').substring(1) === entry.target.id) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }, { threshold: 0.5 });

        sections.forEach(section => this.navObserver.observe(section));
    },

    initNavbarScroll() {
        const navbar = DOM.query('.navbar');
        const hero = DOM.query('#hero');

        const handleScroll = () => {
            // Existing: Add/remove scrolled class for background effect
            if (window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }

            // Mobile Only: Hero section scroll detection for animation
            // ONLY applies if user is logged in (navbar has .registered-nav)
            if (window.innerWidth <= 768 && hero && navbar.classList.contains('registered-nav')) {
                const heroBottom = hero.offsetTop + hero.offsetHeight;
                // Trigger at 30% through the hero section
                if (window.scrollY > heroBottom * 0.3) {
                    navbar.classList.add('scrolled-past-hero');
                } else {
                    navbar.classList.remove('scrolled-past-hero');
                }
            } else {
                // Ensure class is removed if conditions not met (e.g. resized or logged out)
                navbar.classList.remove('scrolled-past-hero');
            }
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll(); // Run once on init
    }
};

/* ==============================================
   SMOOTH SCROLL MODULE (Lenis)
   ============================================== */

const SmoothScroll = {
    lenis: null,

    init() {
        if (typeof Lenis === 'undefined') return;

        this.lenis = new Lenis({
            duration: 1.2,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            direction: 'vertical',
            gestureDirection: 'vertical',
            smooth: true,
            mouseMultiplier: 1,
            smoothTouch: true,
            touchMultiplier: 2,
        });

        window.lenis = this.lenis;

        const raf = (time) => {
            this.lenis.raf(time);
            requestAnimationFrame(raf);
        };

        requestAnimationFrame(raf);

        // Connect anchors to Lenis scroll
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            // Skip generator triggers handled by Navigation
            if (anchor.matches('.logo, #navGenLink, #footerGenLink, #aboutGenLink')) return;

            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = anchor.getAttribute('href').substring(1);
                const target = document.getElementById(targetId);
                if (target) {
                    // Center the section in viewport
                    const offset = -1 * (window.innerHeight - target.offsetHeight) / 2;
                    this.lenis.scrollTo(target, { offset: offset });
                }
            });
        });
    }
};

/* ==============================================
   NAVIGATION MODULE (Event Delegation)
   ============================================== */

const Navigation = {
    init() {
        this.initGeneratorTriggers();
        UI.injectSVGBorders();
    },

    initGeneratorTriggers() {
        document.body.addEventListener('click', (e) => {
            const trigger = e.target.closest('.logo, #navGenLink, #footerGenLink, #aboutGenLink');
            if (!trigger) return;

            const href = trigger.getAttribute('href');
            if (href && (href === '#' || href === '#hero' || href.includes('index.html'))) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.scrollToGenerator();
            }
        });
    },

    triggerPulse() {
        if (State.isAnimationCooldown) return;

        State.isAnimationCooldown = true;
        setTimeout(() => { State.isAnimationCooldown = false; }, CONFIG.ANIMATION_COOLDOWN_MS);

        const pulseWrapper = DOM.get('pulseWrapper');
        const searchCard = DOM.get('searchCard');

        if (pulseWrapper && searchCard) {
            // Clear any existing cleanup timeout to prevent "early removal" glitches
            if (State.pulseCleanupTimeout) {
                clearTimeout(State.pulseCleanupTimeout);
                State.pulseCleanupTimeout = null;
            }

            // Sync visual state with card lock state
            if (searchCard.classList.contains('locked')) {
                pulseWrapper.classList.add('pulse-locked');
            } else {
                pulseWrapper.classList.remove('pulse-locked');
            }

            // Restart animation
            pulseWrapper.classList.remove('highlight-pulse');
            void pulseWrapper.offsetWidth; // Trigger reflow
            pulseWrapper.classList.add('highlight-pulse');

            // Schedule cleanup
            State.pulseCleanupTimeout = setTimeout(() => {
                pulseWrapper.classList.remove('highlight-pulse', 'pulse-locked');
                State.pulseCleanupTimeout = null;
            }, 2000);
        }
    },

    scrollToGenerator() {
        const searchCard = DOM.get('searchCard');
        if (!searchCard) return;

        // 1. Strict Cooldown Check
        if (State.isAnimationCooldown) {
            // Unconditional Scroll anyway (user expected navigation)
            this.smoothScrollTo('#hero', searchCard);
            return;
        }

        // 2. Cleanup existing observers
        if (State.pulseObserver) {
            State.pulseObserver.disconnect();
            State.pulseObserver = null;
        }

        // 3. Smooth Scroll
        this.smoothScrollTo('#hero', searchCard);

        // 4. Set up observer for pulse
        State.pulseObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry.isIntersecting) {
                this.triggerPulse();
                State.pulseObserver.disconnect();
                State.pulseObserver = null;
            }
        }, { threshold: 0.6 });

        State.pulseObserver.observe(searchCard);
    },

    smoothScrollTo(selector, fallbackEl) {
        const isMobile = window.innerWidth <= 768;

        // On mobile, if targeting the hero section, we focus on the searchCard specifically
        const target = (isMobile && selector === '#hero' && fallbackEl) ? fallbackEl : selector;

        if (window.lenis) {
            window.lenis.scrollTo(target, {
                duration: 2.0, // Increased for a more cinematic and smooth feel
                easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // High-end smoothing curve
                // Center the element in viewport on mobile
                offset: isMobile ? -window.innerHeight / 2 + (fallbackEl ? fallbackEl.offsetHeight / 2 : 0) : 0,
                force: true
            });
        } else {
            const el = typeof target === 'string' ? document.querySelector(target) : target;
            if (el) {
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: isMobile ? 'center' : 'start',
                    inline: 'nearest'
                });
            }
        }

        // Update URL hash without jumping
        const hash = typeof selector === 'string' ? selector : '#hero';
        history.pushState("", document.title, window.location.pathname + window.location.search + hash);
    }
};

/* ==============================================
   EVENT HANDLERS
   ============================================== */

const Events = {
    init() {
        // Register Btn (Header)
        const registerBtn = DOM.get('registerHeaderBtn');
        if (registerBtn) {
            registerBtn.addEventListener('click', () => UI.showTermsModal());
        }

        // User Dropdown Toggle
        const userIcon = DOM.get('userAccountIcon');
        const userDropdown = DOM.get('userDropdown');
        if (userIcon && userDropdown) {
            userIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                userDropdown.classList.toggle('open');
            });

            // Close dropdown on outside click
            document.addEventListener('click', (e) => {
                if (!userIcon.contains(e.target) && !userDropdown.contains(e.target)) {
                    userDropdown.classList.remove('open');
                }
            });
        }

        // Logout Btn
        const logoutBtn = DOM.get('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                if (userDropdown) userDropdown.classList.remove('open');
                Auth.logout();
            });
        }

        // Search Btn
        const searchBtn = DOM.get('searchBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => Search.start());
        }

        // Copy Username
        const outputValue = DOM.get('outputValue');
        if (outputValue) {
            outputValue.addEventListener('click', () => Clipboard.copyUsername());
        }

        // Terms Modal Overlay / Close
        const termsModal = DOM.get('termsModal');
        if (termsModal) {
            termsModal.addEventListener('click', (e) => {
                if (e.target === termsModal) UI.hideTermsModal();
            });
        }

        // Confirm Terms Btn (NOW CREATE ACCOUNT BTN)
        const confirmTermsBtn = DOM.get('confirmTermsBtn');
        if (confirmTermsBtn) {
            confirmTermsBtn.addEventListener('click', () => Auth.register());
        }

        // --- 3-STEP REGISTRATION LOGIC ---
        const startRegisterBtn = DOM.get('startRegisterBtn');
        const nextToPasswordBtn = DOM.get('nextToPasswordBtn');
        const termsStep1 = DOM.get('termsStep1');
        const termsStep2 = DOM.get('termsStep2');
        const termsStep3 = DOM.get('termsStep3');

        // Step 1 -> Step 2 (Terms -> Username) WITH FINGERPRINT CHECK
        if (startRegisterBtn && termsStep1 && termsStep2) {
            startRegisterBtn.addEventListener('click', async () => {
                const termsStepExisting = DOM.get('termsStepExisting');
                const existingUsernameEl = DOM.get('existingUsername');

                // Show loading state
                startRegisterBtn.classList.add('loading');

                try {
                    // Generate current fingerprint
                    const currentFingerprint = Fingerprint.generate();

                    // Search for existing account
                    const existingAccount = await Fingerprint.findExistingAccount(currentFingerprint);

                    // Remove loading state
                    startRegisterBtn.classList.remove('loading');

                    if (existingAccount && termsStepExisting) {
                        // Found existing account - show existing step
                        State.existingUserId = existingAccount.userId;
                        State.existingUserData = existingAccount.userData;

                        if (existingUsernameEl) {
                            existingUsernameEl.textContent = existingAccount.userData.username || 'مستخدم';
                        }

                        animateStepTransition(termsStep1, termsStepExisting, null);
                    } else {
                        // No existing account - proceed to username step
                        animateStepTransition(termsStep1, termsStep2, 'regUsername');
                    }
                } catch (error) {
                    console.error('Fingerprint check error:', error);
                    startRegisterBtn.classList.remove('loading');
                    // On error, proceed normally
                    animateStepTransition(termsStep1, termsStep2, 'regUsername');
                }
            });
        }

        // Step 2 -> Step 3 (Username -> Password)
        if (nextToPasswordBtn && termsStep2 && termsStep3) {
            nextToPasswordBtn.addEventListener('click', () => {
                const usernameInput = DOM.get('regUsername');
                if (!usernameInput.value.trim()) {
                    UI.showToast('يرجى إدخال اسم المستخدم', 'error');
                    return;
                }
                animateStepTransition(termsStep2, termsStep3, 'regPassword');
            });
        }

        function animateStepTransition(currentStep, nextStep, focusId) {
            // Animate Current Step Out
            currentStep.classList.add('step-exit');

            setTimeout(() => {
                currentStep.style.display = 'none';
                currentStep.classList.remove('step-exit');

                // Show Next Step with Animation
                nextStep.style.display = 'block';
                nextStep.classList.add('step-enter');

                setTimeout(() => {
                    nextStep.classList.remove('step-enter');
                }, 300);

                // Focus Input
                if (focusId) {
                    const input = DOM.get(focusId);
                    if (input) input.focus();
                }
            }, 300);
        }

        // Toggle Password Visibility
        const togglePassword = DOM.get('togglePassword');
        const passwordInput = DOM.get('regPassword');
        if (togglePassword && passwordInput) {
            togglePassword.addEventListener('click', () => {
                const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                passwordInput.setAttribute('type', type);
                togglePassword.classList.toggle('fa-eye');
                togglePassword.classList.toggle('fa-eye-slash');
            });
        }

        // Enable/Disable buttons based on input validation
        const usernameInput = DOM.get('regUsername');
        if (usernameInput && nextToPasswordBtn) {
            usernameInput.addEventListener('input', () => {
                nextToPasswordBtn.disabled = usernameInput.value.trim().length < 3;
            });
        }

        if (passwordInput && confirmTermsBtn) {
            passwordInput.addEventListener('input', () => {
                confirmTermsBtn.disabled = passwordInput.value.trim().length < 6;
            });
        }

        // Login to Existing Account Button
        const loginExistingBtn = DOM.get('loginExistingBtn');
        if (loginExistingBtn) {
            loginExistingBtn.addEventListener('click', () => {
                if (State.existingUserId && State.existingUserData) {
                    // Restore user session
                    State.userId = State.existingUserId;
                    State.userData = State.existingUserData;
                    localStorage.setItem('clousx_user_id', State.existingUserId);
                    localStorage.setItem('clousx_is_registered', 'true');

                    // Hide modal and unlock card
                    UI.hideTermsModal();
                    UI.unlockCard();

                    // Restore rate limit countdown if active
                    if (State.existingUserData.lastUsage) {
                        const timePassed = Date.now() - State.existingUserData.lastUsage;
                        const remainingTime = CONFIG.RATE_LIMIT_MS - timePassed;

                        if (remainingTime > 0) {
                            // Start countdown timer
                            Auth.startCountdown(remainingTime);

                            // Display last generated username
                            if (State.existingUserData.lastUsername) {
                                UI.displayUsername(State.existingUserData.lastUsername);
                                State.currentUsername = State.existingUserData.lastUsername;
                                localStorage.setItem('lastGeneratedUser', State.existingUserData.lastUsername);
                            }
                        }
                    }

                    // UI.showToast('regToast'); // Removed per user request
                    UI.highlightSearchCard();

                    // Clean up temp state
                    State.existingUserId = null;
                    State.existingUserData = null;
                }
            });
        }

        // Reset form when modal closes (Helper to ensure clean state next time)
        // We can hook into UI.hideTermsModal or just leave it. 
        // For now, this is sufficient.

        // --- RATING SYSTEM EVENTS ---
        const ratingLabel = DOM.query('.rating-label');
        if (ratingLabel) {
            ratingLabel.addEventListener('click', (e) => {
                // Only open if not disabled and has a username
                if (!ratingLabel.classList.contains('disabled') && State.currentUsername && !State.hasRatedCurrent) {
                    UI.showRatingModal(State.currentUsername);
                }
            });
        }

        const ratingStars = DOM.queryAll('#ratingStars .star');
        ratingStars.forEach((star, index) => {
            // Click to rate
            star.addEventListener('click', () => {
                const rating = parseInt(star.dataset.value);
                UI.handleRating(rating);
            });

            // Hover to preview
            star.addEventListener('mouseenter', () => {
                // Fill all stars up to current one
                ratingStars.forEach((s, i) => {
                    if (i <= index) {
                        s.classList.add('hover-filled');
                    } else {
                        s.classList.remove('hover-filled');
                    }
                });
            });
        });

        // Clear hover effect when leaving the container
        const starsContainer = DOM.get('ratingStars');
        if (starsContainer) {
            starsContainer.addEventListener('mouseleave', () => {
                ratingStars.forEach(s => s.classList.remove('hover-filled'));
            });
        }

        // Close Rating Modal on Outside Click
        const ratingModal = DOM.get('ratingModal');
        if (ratingModal) {
            ratingModal.addEventListener('click', (e) => {
                if (e.target === ratingModal) {
                    UI.hideRatingModal();
                }
            });
        }

        // --- INSTANT SCROLL FOR LOGO ---
        const logos = DOM.queryAll('.logo');
        logos.forEach(logo => {
            logo.addEventListener('click', (e) => {
                e.preventDefault();
                // Trigger centralized highlight logic
                UI.highlightSearchCard();
            });
        });
    }
};

/* ==============================================
   APPLICATION INITIALIZATION
   ============================================== */

const App = {
    async init() {
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }
        window.scrollTo(0, 0);

        // --- CONNECTION MONITOR ---
        // Instead of forcing hide, we warn about slow connection
        setTimeout(() => {
            const loader = DOM.get('globalLoader');
            // If loader is still visible after 6 seconds
            if (loader && !loader.classList.contains('hidden')) {
                const slowText = DOM.query('.loader-slow-text');
                if (slowText) {
                    slowText.classList.remove('hidden');
                    // Force reflow
                    void slowText.offsetWidth;
                    slowText.classList.add('show');
                }
            }
        }, 6000); // Show warning after 6 seconds

        // Safety timeout extended to 45 seconds (only for extreme cases)
        const safetyTimeout = setTimeout(() => {
            console.warn('Extended Safety Timeout: Force hiding loader');
            UI.hideLoader();
            document.body.classList.add('loaded');
        }, 45000);

        State.userId = Auth.getPersistentUserId();

        Firebase.init();

        ScrollAnimation.init();
        Navigation.init();
        ProgressBar.init();
        Events.init(); // Initialize Event Listeners
        SmoothScroll.init();

        try {
            await Auth.checkUserStatus();
        } catch (e) {
            console.error('Auth Check Failed:', e);
        }

        // Subscribe to real-time stats
        Firebase.subscribeToStats((stats) => {
            UI.updateStats(stats.generated, stats.users);
        });

        // Subscribe to real-time User Data (Registration & Rate Limit)
        if (State.userId) {
            Firebase.subscribeToUser(State.userId, (data) => {
                if (data) {
                    // CASCADING SYNC (Partial): If lastUsage removed from User, remove from IP
                    if (State.userData && State.userData.lastUsage && !data.lastUsage && State.userIp) {
                        Firebase.updateIPRestriction(State.userIp, {
                            lastUsage: null,
                            lastUsername: null
                        });
                    }

                    State.userData = data;

                    // 1. Sync Registration
                    if (data.registeredAt) {
                        localStorage.setItem('clousx_is_registered', 'true');
                        UI.unlockCard();
                    }

                    // 2. Sync User Rate Limit
                    Auth.checkRateLimit(data);
                } else {
                    // DELETED: User node removed -> Log out / Lock UI
                    localStorage.removeItem('clousx_is_registered');
                    State.userData = null;
                    UI.lockCard(); // Locks UI and resets Output Value
                    State.currentUsername = null;

                    // CASCADING SYNC: Clear IP Activity (Rate Limit & Last Username)
                    if (State.userIp) {
                        Firebase.updateIPRestriction(State.userIp, {
                            lastUsage: null,
                            lastUsername: null
                        });
                    }
                }
            });
        }

        // Subscribe to real-time IP Data (IP Rate Limit)
        try {
            const ipInfo = await Network.getPublicIP();
            if (ipInfo && ipInfo.cleanIp) {
                State.userIp = ipInfo.cleanIp; // Store for cascading delete

                Firebase.subscribeToIP(ipInfo.cleanIp, (data) => {
                    const isRegistered = localStorage.getItem('clousx_is_registered') === 'true';

                    if (data) {
                        const timePassed = Date.now() - (data.lastUsage || 0);
                        if (timePassed < CONFIG.RATE_LIMIT_MS) {
                            // CRITICAL FIX: Only update UI if registered
                            if (isRegistered) {
                                Auth.startCountdown(CONFIG.RATE_LIMIT_MS - timePassed);
                                // Also sync username if available
                                if (data.lastUsername) {
                                    UI.displayUsername(data.lastUsername);
                                    State.currentUsername = data.lastUsername;
                                }
                            }
                        }
                    } else {
                        // DELETED: IP Restriction removed

                        // CASCADING SYNC: Clear User Activity (Rate Limit & Last Username)
                        // Don't delete the whole user, just reset their limits so they can search again
                        if (State.userId) {
                            Firebase.updateUserData(State.userId, {
                                lastUsage: null,
                                lastUsername: null
                            });
                            // Also update local state
                            if (State.userData) {
                                State.userData.lastUsage = null;
                                State.userData.lastUsername = null;
                            }
                        }

                        // 1. Stop Countdown
                        if (State.countdownInterval) {
                            clearInterval(State.countdownInterval);
                            State.countdownInterval = null;
                        }

                        // 2. Reset Status Text
                        UI.updateStatusText('سيتم البحث عن يوزرات شبه رباعية متاحة');

                        // 3. Clear Current Username Display
                        const outputValue = DOM.get('outputValue');
                        if (outputValue) {
                            outputValue.innerHTML = 'اضغط للبدء';
                            outputValue.classList.remove('found');
                        }
                        State.currentUsername = null;

                        // 4. Unlock Search Button (only if registered)
                        const isRegistered = localStorage.getItem('clousx_is_registered') === 'true';
                        if (isRegistered) {
                            const searchBtn = DOM.get('searchBtn');
                            if (searchBtn) searchBtn.disabled = false;

                            const card = DOM.get('searchCard');
                            if (card) {
                                card.classList.remove('preparing', 'reactivate');
                            }
                        }
                    }
                });
            }

        } catch (e) {
            console.warn('Failed to subscribe to IP updates', e);
        }

        // Initialize Reviews Section
        try {
            UI.initReviews();
        } catch (e) {
            console.warn('Reviews init error:', e);
        }

        UI.updateLoaderText("جاهز!");

        clearTimeout(safetyTimeout); // Clear timeout if successful

        setTimeout(() => {
            UI.hideLoader();

            setTimeout(() => {
                document.body.classList.add('loaded');
            }, 500);
        }, 800);
    }
};

/* ==============================================
   DOM READY
   ============================================== */

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}
