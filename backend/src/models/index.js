// Association setups between models
const { sequelize } = require('../config/database');
const User = require('./User');
const Service = require('./Service');
const Booking = require('./Booking');
const Transaction = require('./Transaction');
const LearningPath = require('./LearningPath');
const PathCourse = require('./PathCourse');
const XpLog = require('./XpLog');
const Badge = require('./Badge');
const CommunityPost = require('./CommunityPost');
const CommunityComment = require('./CommunityComment');
const Portfolio = require('./Portfolio');
const MentorshipSession = require('./MentorshipSession');
const QrCertificate = require('./QrCertificate');
const Event = require('./Event');
const EventRegistration = require('./EventRegistration');
const AnalyticsEvent = require('./AnalyticsEvent');
const AppLocale = require('./AppLocale');
const UserConsent = require('./UserConsent');
const UserBadge = require('./UserBadge');
const BusinessProfile = require('./BusinessProfile');
const Membership = require('./Membership');

// A Service belongs to a Provider (User)
Service.belongsTo(User, { foreignKey: 'provider_id', as: 'provider' });
User.hasMany(Service, { foreignKey: 'provider_id', as: 'services' });

// A Booking belongs to a Client (User)
Booking.belongsTo(User, { foreignKey: 'client_id', as: 'client' });
User.hasMany(Booking, { foreignKey: 'client_id', as: 'clientBookings' });

// A Booking belongs to a Provider (User)
Booking.belongsTo(User, { foreignKey: 'provider_id', as: 'provider' });
User.hasMany(Booking, { foreignKey: 'provider_id', as: 'providerBookings' });

// A Booking belongs to a Service
Booking.belongsTo(Service, { foreignKey: 'service_id', as: 'service' });
Service.hasMany(Booking, { foreignKey: 'service_id', as: 'bookings' });

// A Transaction belongs to a Booking
Transaction.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
Booking.hasOne(Transaction, { foreignKey: 'booking_id', as: 'transaction' });

// Membership Associations
User.hasMany(Membership, { foreignKey: 'user_id', as: 'memberships' });
Membership.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

BusinessProfile.hasMany(Membership, { foreignKey: 'business_profile_id', as: 'memberships' });
Membership.belongsTo(BusinessProfile, { foreignKey: 'business_profile_id', as: 'businessProfile' });

module.exports = {
  sequelize,
  User,
  Service,
  Booking,
  Transaction,
  LearningPath,
  PathCourse,
  XpLog,
  Badge,
  CommunityPost,
  CommunityComment,
  Portfolio,
  MentorshipSession,
  QrCertificate,
  Event,
  EventRegistration,
  AnalyticsEvent,
  AppLocale,
  UserConsent,
  UserBadge,
  BusinessProfile,
  Membership
};
