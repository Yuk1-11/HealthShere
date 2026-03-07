<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyChyjKJffDpidR0VAlEayy5DBtIFFa4iYc",
    authDomain: "healthshere-b9f5d.firebaseapp.com",
    projectId: "healthshere-b9f5d",
    storageBucket: "healthshere-b9f5d.firebasestorage.app",
    messagingSenderId: "678445018995",
    appId: "1:678445018995:web:2dc89f3558ae21bb7a1f06",
    measurementId: "G-KTBH35WFB7"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
