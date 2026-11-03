module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('academy_certificates', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW }
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('academy_certificates');
  }
};
