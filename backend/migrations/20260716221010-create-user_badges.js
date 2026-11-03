module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('user_badges', {
      user_id: { type: Sequelize.INTEGER, allowNull: false },
      badge_id: { type: Sequelize.INTEGER, references: { model: 'badges', key: 'id' }, allowNull: false },
      earned_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
      primaryKey: { type: Sequelize.BOOLEAN, defaultValue: false }
    });
    await queryInterface.addConstraint('user_badges', {
      type: 'primary key',
      fields: ['user_id', 'badge_id'],
      name: 'pk_user_badges'
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('user_badges');
  }
};
