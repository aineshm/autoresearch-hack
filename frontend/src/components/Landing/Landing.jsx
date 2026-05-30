import Background from '../Background/Background';
import Nav from '../Nav/Nav';
import Hero from '../Hero/Hero';
import './Landing.css';

export default function Landing({ onLogin, onSignup }) {
  return (
    <div className="landing">
      <Background />
      <Nav onLogin={onLogin} onSignup={onSignup} />
      <Hero />
    </div>
  );
}
