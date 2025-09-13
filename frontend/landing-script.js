// frontend/landing-script.js

document.addEventListener('DOMContentLoaded', () => {
    const testimonials = [
        {
            quote: "This is a game-changer. I've automated my entire sales process on Telegram and my engagement has skyrocketed. The Smart Selling feature is pure genius!",
            author: "— Sarah J., Community Manager"
        },
        {
            quote: "I manage over 20 accounts for clients. The multi-account dashboard is a lifesaver. What used to take hours now takes minutes. Highly recommended!",
            author: "— Mark T., Digital Marketer"
        },
        {
            quote: "The automated forwarding is flawless. It runs 24/7 without a single hiccup. The live logs give me complete peace of mind. Worth every penny.",
            author: "— David L., Crypto Analyst"
        }
    ];

    let currentIndex = 0;
    const carousel = document.getElementById('testimonial-carousel');

    function showTestimonial() {
        const testimonial = testimonials[currentIndex];
        // Fade out
        carousel.classList.remove('animate__fadeIn');
        carousel.classList.add('animate__fadeOut');
        
        setTimeout(() => {
            carousel.innerHTML = `
                <p class="testimonial-quote">"${testimonial.quote}"</p>
                <cite class="testimonial-author">${testimonial.author}</cite>
            `;
            // Fade in
            carousel.classList.remove('animate__fadeOut');
            carousel.classList.add('animate__animated', 'animate__fadeIn');
        }, 500); // Wait for fade out animation to finish

        currentIndex = (currentIndex + 1) % testimonials.length;
    }

    // Show the first testimonial immediately and then cycle
    showTestimonial();
    setInterval(showTestimonial, 7000); // Change testimonial every 7 seconds

    fetchAndDisplayPlans();
});

async function fetchAndDisplayPlans() {
    const container = document.getElementById('pricing-plans-container');
    if (!container) return;
    try {
        const response = await fetch('/api/plans');
        const plans = await response.json();
        if (plans.length === 0) {
            container.innerHTML = '<p class="text-center text-muted">Pricing plans will be available soon.</p>';
            return;
        }
        container.innerHTML = ''; // Clear loading message
        plans.forEach(plan => {
            const card = `
                <div class="col-md-6 col-lg-3">
                    <div class="pricing-card">
                        <h3 class="plan-name">${plan.name}</h3>
                        <div class="plan-price">$${plan.price.toFixed(2)}</div>
                    </div>
                </div>
            `;
            container.innerHTML += card;
        });
    } catch (error) {
        console.error("Failed to fetch pricing plans:", error);
        container.innerHTML = '<p class="text-center text-danger">Could not load pricing plans.</p>';
    }
}