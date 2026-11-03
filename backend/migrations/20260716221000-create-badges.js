module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('badges', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT },
      icon_url: { type: Sequelize.STRING(500) },
      category: { type: Sequelize.STRING(100) },
      criteria: { type: Sequelize.JSONB }
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('badges');
  }
};
