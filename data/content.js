/* ===========================================================================
   data/content.js — the only file you need to edit to change site content.
   Edit, save, refresh. There is no build step.

   Loaded by a plain <script> tag rather than fetched as JSON, so the site
   also works when you open index.html directly from disk (fetch() of a
   local file is blocked by the browser). It also means this file tolerates
   trailing commas and // comments, which strict JSON does not.

   Convention: every value is HTML-escaped when rendered. Keys ending in
   "Html" are inserted as raw markup instead — use sparingly.
   =========================================================================== */

window.PORTFOLIO = {

  /* ------------------------------------------------------------------ site */
  site: {
    title: "Siddharth Singh | Portfolio",
    description:
      "Portfolio of Siddharth Singh, a software engineer working in Java, " +
      "Python and Spring.",
    brand: "sid.",
    // The copyright year is computed when the page renders. Never hardcode it.
    copyrightHolder: "Siddharth Singh",
    copyrightSuffix: "All rights reserved",
    nav: [
      { label: "Home", href: "#home" },
      { label: "About me", href: "#about" },
      { label: "Skills", href: "#skills" },
      { label: "Projects", href: "#prj" },
      { label: "Contact Me", href: "#contact" },
    ],
  },

  /* --------------------------------------------------------------- profile */
  profile: {
    greeting: "Hello!",
    name: "Siddharth Singh",
    // Typed out one character at a time, joined with ", ".
    roles: ["Software Engineer", "Explorer", "Chess Player"],
    typeSpeedMs: 110,
    tagline: "Eat, Sleep, Code",
    taglineIcon: "fa-solid fa-repeat",
    bio:
      "I'm a passionate software developer with a strong foundation in Java " +
      "and Python. Proficient at solving real-world problems, I've contributed " +
      "to various projects, including web apps, Android apps, and ERP systems. " +
      "My dedication to staying updated with industry trends fuels my " +
      "continuous learning journey.",
    // Drop the PDF at this path to make the button work. Set url to "" and
    // the button is not rendered at all.
    cv: { url: "assets/Siddharth_Singh_CV.pdf", label: "View CV" },
    contact: { label: "Get in Touch" },
  },

  /* ------------------------------------------------------------- education */
  // score and dates are optional; the line is skipped when absent.
  education: [
    {
      icon: "fa-solid fa-graduation-cap",
      degree: "B.Tech - Computer Science",
      institution: "Shri G.S. Institute of Technology & Science, Indore",
      score: "C.G.P.A. - 8.5/10",
      dates: "Aug, 2019-Aug, 2023",
    },
    {
      icon: "fa-solid fa-building-columns",
      degreeHtml: "12<sup>th</sup>", // raw-markup escape hatch
      institution: "Jawaharlal Nehru School, Bhopal",
      score: "90.2%",
      // no dates — the renderer omits the line
    },
  ],

  /* ---------------------------------------------------------------- skills */
  // Add or remove entries freely: the grid reflows to fit however many
  // there are. `category` is unused today and exists so skills can be
  // grouped later without changing the renderer's contract.
  skills: [
    { name: "Java", icon: "icons/java.png", category: "Languages" },
    { name: "C", icon: "icons/cprog.png", category: "Languages" },
    { name: "Python", icon: "icons/python.png", category: "Languages" },
    { name: "HTML", icon: "icons/html-5.png", category: "Web" },
    { name: "CSS", icon: "icons/css.png", category: "Web" },
    { name: "JavaScript", icon: "icons/java-script.png", category: "Web" },
    { name: "Git", icon: "icons/git.png", category: "Tools" },
    { name: "Linux", icon: "icons/linux.png", category: "Tools" },
    { name: "SQL", icon: "icons/sql.jpg", category: "Data" },
    { name: "MySQL", icon: "icons/mysql.png", category: "Data" },
    { name: "PostgreSQL", icon: "icons/postgres.png", category: "Data" },
    { name: "Spring", icon: "icons/spring.png", category: "Frameworks" },
    { name: "AWS", icon: "icons/aws.png", category: "Cloud" },
  ],

  /* -------------------------------------------------------------- projects */
  projects: [
    {
      title: "MetaPath",
      description:
        "MetaPath is an AR-based indoor navigation system for handheld " +
        "devices to make indoor navigation seamless and interactive.",
      image: "icons/AR-Navigation-3-scaled.jpg",
      alt: "A phone running MetaPath, showing AR waypoints over a corridor",
      link: {
        url: "https://drive.google.com/file/d/1IkaxlK0f_oU6EgV6QQUT67MkqTu1dAwv/view?usp=drive_link",
        label: "Demo",
      },
    },
    {
      title: "OS Simulation",
      description:
        "Simulation of processes in the Operating System, to check the " +
        "performance of the system against sequential execution of processes.",
      image: "icons/OS.jpg",
      alt: "Illustration of an operating system scheduling processes",
      link: { url: "https://github.com/siddharth0801/OS-Simulation", label: "GitHub" },
    },
    {
      title: "Sudoku Solver",
      description: "A command line solver for sudoku puzzles.",
      image: "icons/sudoku.png",
      alt: "A partially filled sudoku grid",
      link: { url: "https://github.com/siddharth0801/SudokuSolver", label: "GitHub" },
    },
  ],

  /* --------------------------------------------------------------- socials */
  // One array, two placements. `showIn` decides where each link appears, so
  // every URL is stored exactly once — which is what stopped the two
  // LinkedIn links in the old markup from drifting apart again.
  // `aboutClass` is the button variant used in the About placement only.
  socials: [
    {
      name: "Facebook",
      icon: "fa-brands fa-facebook-f",
      url: "https://www.facebook.com/people/Siddharth-Singh/100041000264340/",
      showIn: ["footer"],
    },
    {
      name: "Instagram",
      icon: "fa-brands fa-instagram",
      url: "https://www.instagram.com/singh.siddharth01/",
      showIn: ["footer"],
    },
    {
      name: "LinkedIn",
      icon: "fa-brands fa-linkedin-in",
      url: "https://www.linkedin.com/in/siddharth0801/",
      showIn: ["about", "footer"],
      aboutClass: "btn-info text-white",
    },
    {
      name: "GitHub",
      icon: "fa-brands fa-github",
      url: "https://github.com/siddharth0801/",
      showIn: ["about", "footer"],
      aboutClass: "btn-dark",
    },
  ],

  /* ---------------------------------------------------------- contact form */
  contact: {
    heading: "Get in Touch",
    // Public Formspree endpoint. It is visible in the page source either way.
    endpoint: "https://formspree.io/f/mdovwwka",
    submitLabel: "Send Message",
    sendingLabel: "Sending…",
    successMessage: "Thanks! Your message has been sent.",
    errorMessage: "Something went wrong. Please try again, or email me directly.",
    networkErrorMessage: "Network error — check your connection and try again.",
    fields: [
      { name: "name", label: "Your Name", type: "text", required: true },
      { name: "email", label: "Your Email", type: "email", required: true },
      { name: "message", label: "Message", type: "textarea", required: true, rows: 5 },
    ],
  },
};
