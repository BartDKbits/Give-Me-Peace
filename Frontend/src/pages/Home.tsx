import React, { useEffect, useRef, useState } from "react";
import { auth, provider } from "../firebase";
import {
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    type User,
} from "firebase/auth";
import styles from "./Home.module.css";
import DataView from "./DataView";

const Home: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [heroText, setHeroText] = useState("");
    const [heroVisible, setHeroVisible] = useState(false);
    const [aboutVisible, setAboutVisible] = useState(false);
    const [navVisible, setNavVisible] = useState(true);
    const [lastScroll, setLastScroll] = useState(0);
    const [showData, setShowData] = useState(false);

    const aboutRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, setUser);
        return unsub;
    }, []);

    useEffect(() => {
        if (!user) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setHeroText("Hey there.");
            setHeroVisible(true);

            setTimeout(() => {
                setHeroVisible(false);

                setTimeout(() => {
                    setHeroText("Where would you like to study?");
                    setHeroVisible(true);
                }, 600);
            }, 2000);
        } else {
            setHeroText(`Hi, ${user.displayName}.`);
            setHeroVisible(true);

            setTimeout(() => {
                setHeroVisible(false);

                setTimeout(() => {
                    setHeroText("Where would you like to study?");
                    setHeroVisible(true);
                }, 600);
            }, 2500);
        }
    }, [user]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) setAboutVisible(true);
            },
            { threshold: 0.3 },
        );

        if (aboutRef.current) observer.observe(aboutRef.current);

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const handleScroll = () => {
            const current = window.scrollY;

            if (current > lastScroll && current > 100) setNavVisible(false);
            else setNavVisible(true);

            setLastScroll(current);
        };

        window.addEventListener("scroll", handleScroll);

        return () => window.removeEventListener("scroll", handleScroll);
    }, [lastScroll]);

    const login = () => signInWithPopup(auth, provider);
    const logout = () => signOut(auth);

    return (
        <div>
            {!showData && (
                <nav
                    className={`${styles.floatingNavbar} ${
                        navVisible ? styles.navVisible : styles.navHidden
                    }`}
                >
                    <div className={styles.logo}>GMP 🫛</div>

                    <button
                        className={styles.navBtn}
                        onClick={user ? logout : login}
                    >
                        {user ? "Logout" : "Login"}
                    </button>
                </nav>
            )}

            <div className={styles.viewport}>
                <div
                    className={`${styles.slider} ${
                        showData ? styles.showData : ""
                    }`}
                >
                    <div className={styles.page}>
                        <section className={styles.hero}>
                            <div className={styles.heroCenter}>
                                <div className={styles.bigLogo}>
                                    Give Me Peace...
                                </div>

                                <h1
                                    className={`${styles.heroTitle} ${
                                        heroVisible
                                            ? styles.heroTitleVisible
                                            : ""
                                    }`}
                                >
                                    {heroText}
                                </h1>

                                <button
                                    className={styles.goBtn}
                                    onClick={() => setShowData(true)}
                                >
                                    Let's Go.
                                </button>
                            </div>

                            <div
                                className={styles.arrow}
                                onClick={() =>
                                    window.scrollTo({
                                        top: window.innerHeight,
                                        behavior: "smooth",
                                    })
                                }
                            >
                                ↓
                            </div>
                        </section>

                        <section
                            ref={aboutRef}
                            className={`${styles.about} ${
                                aboutVisible ? styles.aboutVisible : ""
                            }`}
                        >
                            <h2>About</h2>

                            <p>
                                GMP monitors your environment using sensors and
                                shows the best places to study.
                            </p>
                        </section>
                    </div>

                    <div className={styles.page}>
                        <DataView goHome={() => setShowData(false)} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Home;
