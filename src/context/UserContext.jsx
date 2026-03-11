import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import authService from '../services/authService';

const UserContext = createContext();

export const useUser = () => useContext(UserContext);

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : null;
  });
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);
  const [resumeFile, setResumeFile] = useState(null);
  const [questions, setQuestions] = useState(() => {
    const stored = localStorage.getItem('questions');
    return stored ? JSON.parse(stored) : [];
  });
  const [questionType, setQuestionType] = useState('technical');

  // Backend Port Configuration
  const NODE_BACKEND_URL = 'http://localhost:5000'; // Port for Node.js/Express
  const PYTHON_AI_URL = 'http://localhost:8000';   // Port for Python/Flask AI

  // Verify token on mount
  useEffect(() => {
    const verifySession = async () => {
      try {
        const isValid = await authService.verifyToken();
        if (!isValid) {
          logout();
        }
      } catch (error) {
        console.error('Session verification failed:', error);
        logout();
      } finally {
        setLoading(false);
      }
    };

    verifySession();
  }, []);

  const login = async (userData) => {
    try {
      setLoading(true);
      if (!userData || !userData.token) {
        throw new Error(userData?.msg || 'Invalid credentials');
      }
      const backendUser = userData.user || userData;
      const safeUser = {
        id: backendUser.id || backendUser._id || '',
        name: backendUser.name || 'Guest',
        email: backendUser.email || 'noemail@example.com',
        token: userData.token,
      };
      setUser(safeUser);
      localStorage.setItem('user', JSON.stringify(safeUser));
      localStorage.setItem('token', userData.token);
      console.log('User logged in:', safeUser);
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    authService.signout();
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    setRole(null);
    setResumeFile(null);
    setQuestions([]);
    localStorage.removeItem('questions');
    setQuestionType('technical');
    console.log('User logged out.');
  };

  const selectRole = (selectedRole) => {
    setRole(selectedRole);
    console.log('Role selected:', selectedRole);
  };

  const uploadResume = (file) => {
    setResumeFile(file);
    console.log('Resume uploaded:', file?.name);
    if (file) {
      // Increment resume upload counter in Node.js backend
      axios.post(`${NODE_BACKEND_URL}/api/auth/stats/resume-uploaded`).catch(err => {
        console.warn('Failed to update upload stats:', err.message);
      });
    }
  };

  const generateQuestions = async (jobTitle = '', qType = 'technical', difficultyLevel = 'medium', skills = [], numQuestions = 5) => {
    console.log('Generating questions with:', { jobTitle, qType, difficultyLevel, skills, numQuestions, hasResume: !!resumeFile });
    setQuestionType(qType);

    const formData = new FormData();
    if (resumeFile) {
      formData.append('resume', resumeFile);
      formData.append('role', role || jobTitle || 'Technical Candidate');
      formData.append('questionType', qType); // Matches Python request.form.get('questionType')
      formData.append('difficultyLevel', difficultyLevel); // Matches Python request.form.get('difficultyLevel')
      formData.append('jobTitle', jobTitle);
      formData.append('numQuestions', numQuestions); // Matches Python int(request.form.get('numQuestions'))
    } else if (skills.length > 0) {
      formData.append('skills', skills.join(','));
      formData.append('role', jobTitle);
      formData.append('questionType', qType);
      formData.append('difficultyLevel', difficultyLevel);
      formData.append('jobTitle', jobTitle);
      formData.append('numQuestions', numQuestions);
    } else {
      console.error('No resume or skills provided');
      throw new Error('Please upload a resume or provide skills first.');
    }

    try {
      // Send request to Python AI Backend on Port 8000
      const response = await axios.post(
        `${PYTHON_AI_URL}/generate_questions`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      console.log('Python API full response:', response.data);

      // Extract nested data from Python response structure
      const apiData = response.data.questions || {};
      const technicalQuestions = apiData.technical_questions || {};
      const behavioralQuestions = apiData.behavioral_questions || {};
      const scenarioQuestions = apiData.scenario_questions || [];

      // Flatten nested objects into a single array for the UI
      const formattedQuestions = [
        ...Object.entries(technicalQuestions).flatMap(([skill, qList]) =>
          qList.map((text, index) => ({
            id: `tech_${skill}_${index}_${Date.now()}`,
            text,
            type: 'technical',
            category: skill
          }))
        ),
        ...Object.entries(behavioralQuestions).flatMap(([trait, qList]) =>
          qList.map((text, index) => ({
            id: `beh_${trait}_${index}_${Date.now()}`,
            text,
            type: 'behavioral',
            category: trait
          }))
        ),
        ...scenarioQuestions.map((text, index) => ({
          id: `scen_${index}_${Date.now()}`,
          text,
          type: 'scenario',
          category: 'Scenario'
        })),
      ];

      if (formattedQuestions.length === 0) {
        throw new Error('The AI model returned no questions. Please try again.');
      }

      console.log('Formatted questions for UI:', formattedQuestions);
      setQuestions(formattedQuestions);
      localStorage.setItem('questions', JSON.stringify(formattedQuestions));

      // Update generation stats in Node.js backend
      axios.post(`${NODE_BACKEND_URL}/api/auth/stats/questions-generated`, {
        count: formattedQuestions.length
      }).catch(err => console.warn('Failed to update generation stats:', err.message));

      return formattedQuestions;
    } catch (error) {
      console.error('Error in generateQuestions:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Failed to generate questions';
      throw new Error(errorMsg);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <UserContext.Provider
      value={{
        user,
        role,
        resumeFile,
        questions,
        questionType,
        loading,
        login,
        logout,
        selectRole,
        uploadResume,
        generateQuestions,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};