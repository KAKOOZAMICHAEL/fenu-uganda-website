(function ($) {
  "use strict";

  // Wrap the entire content in $(document).ready() to ensure DOM is fully loaded
  $(document).ready(function () {
    // Spinner
    var spinner = function () {
      setTimeout(function () {
        if ($("#spinner").length > 0) {
          $("#spinner").removeClass("show");
        }
      }, 1);
    };
    spinner();

    // Shared original transition style (template-like behavior)
    var baseAnimateIn = "rotateInDownLeft";
    var baseAnimateOut = "rotateOutUpRight";

    // Initiate the wowjs
    new WOW().init();

    // Apply bounce animation to all cards when they come into view
    var cardSelectors =
      ".donation-item, .team-item, .thematic-card, .work-card, .project-feature-card, .project-contact-card, .partner-card, .member-card, .contact-static-card, .value-card, .value-panel, .content-slide-item";
    var cards = document.querySelectorAll(cardSelectors);

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (
            entry.isIntersecting &&
            !entry.target.classList.contains("bounce-animated")
          ) {
            entry.target.classList.add("bounceInCard", "bounce-animated");
            // Optionally stop observing after animation is applied
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px",
      },
    );

    cards.forEach(function (card) {
      observer.observe(card);
    });

    // Reveal-on-scroll for the modern page redesign (Contact, Gallery,
    // Publications, Partners). Elements fade/slide up as they enter view,
    // staggered slightly by their order on the page.
    var revealEls = document.querySelectorAll(".m-reveal");
    if (revealEls.length) {
      var revealObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("m-in");
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
      );
      revealEls.forEach(function (el, i) {
        el.style.transitionDelay = (i % 6) * 0.08 + "s";
        revealObserver.observe(el);
      });
    }

    // Sticky Navbar
    $(window).scroll(function () {
      if ($(this).scrollTop() > 90) {
        $(".nav-bar").addClass("fixed-top nav-scrolled").css("padding", "0");
      } else {
        $(".nav-bar")
          .removeClass("fixed-top nav-scrolled")
          .css("padding", "0px 90px");
      }
    });

    // Back to top button
    $(window).scroll(function () {
      if ($(this).scrollTop() > 300) {
        $(".back-to-top").fadeIn("slow");
      } else {
        $(".back-to-top").fadeOut("slow");
      }
    });
    $(".back-to-top").click(function () {
      $("html, body").animate({ scrollTop: 0 }, 1500, "easeInOutExpo");
      return false;
    });

    // Smooth scroll anchors
    $(".scroll-link").on("click", function (e) {
      var target = $(this.getAttribute("href"));
      if (target.length) {
        e.preventDefault();
        $("html, body").animate(
          {
            scrollTop: target.offset().top - 80,
          },
          1200,
          "easeInOutExpo",
        );
      }
    });

    // Facts counter
    $('[data-toggle="counter-up"]').counterUp({
      delay: 10,
      time: 2000,
    });

    // Statistics bar counters (Team Members, Groups, Partners)
    var statsCounters = document.querySelectorAll(".stats-counter");
    if (statsCounters.length) {
      var runStatsCounter = function (counterEl) {
        var target = parseInt(counterEl.getAttribute("data-target") || "0", 10);
        if (Number.isNaN(target)) return;

        var duration = 1600;
        var startTime = null;

        var step = function (timestamp) {
          if (!startTime) startTime = timestamp;
          var progress = Math.min((timestamp - startTime) / duration, 1);
          counterEl.textContent = String(Math.floor(progress * target));

          if (progress < 1) {
            requestAnimationFrame(step);
          } else {
            counterEl.textContent = String(target);
          }
        };

        requestAnimationFrame(step);
      };

      var statsObserver = new IntersectionObserver(
        function (entries, observer) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              runStatsCounter(entry.target);
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.5 },
      );

      statsCounters.forEach(function (counter) {
        statsObserver.observe(counter);
      });
    }

    // Donation progress
    $(".donation-item .donation-progress").waypoint(
      function () {
        $(".donation-item .progress .progress-bar").each(function () {
          $(this).css("height", $(this).attr("aria-valuenow") + "%");
        });
      },
      { offset: "80%" },
    );

    // Header carousel
    var $headerCarousel = $(".header-carousel");
    $headerCarousel.owlCarousel({
      animateOut: baseAnimateOut,
      animateIn: baseAnimateIn,
      items: 1,
      autoplay: false,
      smartSpeed: 1000,
      dots: false,
      loop: false,
      nav: true,
      navText: [
        '<i class="bi bi-chevron-left"></i>',
        '<i class="bi bi-chevron-right"></i>',
      ],
    });

    // Content carousel for multi-page highlights
    var $contentCarousel = $(".content-carousel");
    $contentCarousel.owlCarousel({
      animateOut: baseAnimateOut,
      animateIn: baseAnimateIn,
      autoplay: true,
      smartSpeed: 900,
      margin: 20,
      dots: false,
      loop: true,
      nav: true,
      navText: [
        '<i class="bi bi-chevron-left"></i>',
        '<i class="bi bi-chevron-right"></i>',
      ],
      responsive: {
        0: { items: 1 },
        768: { items: 2 },
        1024: { items: 3 },
      },
    });

    // Testimonials carousel
    $(".testimonial-carousel").owlCarousel({
      items: 1,
      autoplay: true,
      smartSpeed: 1000,
      animateIn: baseAnimateIn,
      animateOut: baseAnimateOut,
      dots: false,
      loop: true,
      nav: true,
      navText: [
        '<i class="bi bi-chevron-left"></i>',
        '<i class="bi bi-chevron-right"></i>',
      ],
    });
  });
})(jQuery);
